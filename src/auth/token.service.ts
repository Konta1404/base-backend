import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AppConfig } from "../config/app-config.service.js";
import type { User } from "../generated/prisma/client.js";
import type { AccessTokenPayload } from "../common/guards/jwt-auth.guard.js";
import { SessionRevocationService } from "../common/session-revocation.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toPublicUser } from "../users/user.entity.js";
import type { AuthResponse } from "./dto/auth.dto.js";
import { RefreshSuccessorStore } from "./refresh-successor.store.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const invalid = () => new UnauthorizedException("Invalid refresh token.");

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly revocation: SessionRevocationService,
    private readonly successors: RefreshSuccessorStore,
  ) {}

  /** Issue an access token + a new refresh token. Pass `familyId` to continue an existing session. */
  async issue(user: User, familyId: string = randomUUID()): Promise<AuthResponse> {
    const refreshToken = randomBytes(32).toString("base64url");
    const now = Date.now();

    await this.prisma.$transaction([
      // Opportunistic cleanup: expired tokens are useless, even for reuse detection.
      this.prisma.refreshToken.deleteMany({
        where: { userId: user.id, expiresAt: { lt: new Date(now) } },
      }),
      this.prisma.refreshToken.create({
        data: {
          tokenHash: sha256(refreshToken),
          familyId,
          userId: user.id,
          expiresAt: new Date(now + this.config.get("REFRESH_TOKEN_TTL") * 1000),
        },
      }),
    ]);

    return this.response(user, familyId, refreshToken);
  }

  private async response(
    user: User,
    familyId: string,
    refreshToken: string,
  ): Promise<AuthResponse> {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, sid: familyId };
    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken,
      expiresIn: this.config.get("JWT_ACCESS_TTL"),
      user: toPublicUser(user),
    };
  }

  /**
   * Exchange a refresh token for a new pair (rotation).
   *
   * - A token can be used once. Presenting an already-rotated token again is
   *   treated as theft and revokes the whole session (token family)...
   * - ...except within REFRESH_REUSE_GRACE seconds of its rotation: concurrent
   *   refreshes from the frontend (parallel requests, several Next.js instances)
   *   then receive the *same* successor token, so the session never forks into
   *   two live branches and a replay can't mint an independent one.
   */
  async rotate(rawToken: string): Promise<AuthResponse> {
    const now = new Date();
    const tokenHash = sha256(rawToken);
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!token || token.expiresAt <= now) throw invalid();

    const graceSeconds = this.config.get("REFRESH_REUSE_GRACE");
    if (!token.revokedAt) {
      // Claim the token atomically; only one concurrent caller wins.
      const { count } = await this.prisma.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count === 1) {
        const result = await this.issue(token.user, token.familyId);
        await this.successors.remember(tokenHash, result.refreshToken, graceSeconds);
        return result;
      }
    }

    // Already rotated (earlier, or a moment ago by a concurrent request).
    const revokedAt = token.revokedAt ?? now;
    if (now.getTime() - revokedAt.getTime() <= graceSeconds * 1000) {
      const successor = await this.waitForSuccessor(tokenHash);
      if (successor.status === "hit") {
        const live = await this.prisma.refreshToken.findUnique({
          where: { tokenHash: sha256(successor.refreshToken) },
        });
        if (live && !live.revokedAt && live.expiresAt > now) {
          return this.response(token.user, token.familyId, successor.refreshToken);
        }
      } else if (
        successor.status === "unavailable" &&
        (await this.isFamilyActive(token.familyId, now))
      ) {
        // Redis is down, so the successor can't be looked up: stay available and
        // issue a fresh token (the pre-Redis behaviour) rather than log the user out.
        return this.issue(token.user, token.familyId);
      }
    }

    this.logger.warn(`Refresh token reuse detected; revoking session ${token.familyId}`);
    await this.revokeFamily(token.familyId);
    throw invalid();
  }

  /** The winner of a concurrent rotation stores its successor a few ms later; wait briefly. */
  private async waitForSuccessor(tokenHash: string) {
    for (let attempt = 0; ; attempt++) {
      const result = await this.successors.recall(tokenHash);
      if (result.status !== "miss" || attempt >= 20) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Revoke the session a refresh token belongs to. Unknown tokens are ignored. */
  async revoke(rawToken: string): Promise<void> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      select: { familyId: true },
    });
    if (token) await this.revokeFamily(token.familyId);
  }

  /** Sign the user out everywhere: all refresh tokens and all live access tokens. */
  async revokeAllForUser(userId: string): Promise<void> {
    const families = await this.prisma.refreshToken.findMany({
      where: { userId },
      distinct: ["familyId"],
      select: { familyId: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.revocation.revoke(...families.map((f) => f.familyId));
  }

  /** End one session: its refresh tokens and its access tokens. */
  async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.revocation.revoke(familyId);
  }

  private async isFamilyActive(familyId: string, now: Date) {
    const active = await this.prisma.refreshToken.count({
      where: { familyId, revokedAt: null, expiresAt: { gt: now } },
    });
    return active > 0;
  }
}
