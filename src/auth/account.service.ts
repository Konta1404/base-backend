import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { AuthTokenType, type User } from "../generated/prisma/client.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { REDIS } from "../redis/redis.constants.js";
import { UsersService } from "../users/users.service.js";
import { LoginAttemptsService } from "./login-attempts.service.js";
import { hashPassword } from "./password.js";
import { TokenService } from "./token.service.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const invalidLink = () => new BadRequestException("This link is invalid or has expired.");
/** Minimum seconds between two emails of the same kind to the same user. */
const EMAIL_COOLDOWN = 60;

/** Email verification and password reset (one-time links sent by email). */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly attempts: LoginAttemptsService,
  ) {}

  /** Link for the welcome email of a new password account. */
  async verificationUrl(user: User): Promise<string | undefined> {
    if (user.emailVerifiedAt) return undefined;
    const token = await this.createToken(user.id, AuthTokenType.EMAIL_VERIFICATION);
    return this.link("/verify-email", token);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) return;
    if (!(await this.cooldown(`verify:${user.id}`))) return;
    const url = await this.verificationUrl(user);
    if (url) this.mail.sendEmailVerification({ email: user.email, name: user.name, url });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const { userId } = await this.consume(rawToken, AuthTokenType.EMAIL_VERIFICATION);
    await this.users.update(userId, { emailVerifiedAt: new Date() });
  }

  /**
   * Starts a password reset and returns immediately, before even looking the email
   * up: the response is identical — content and timing — whether or not the account
   * exists, so it can't be used to discover accounts.
   */
  requestPasswordReset(email: string): void {
    this.sendResetLink(email).catch((err: Error) =>
      this.logger.error(`Password reset request failed: ${err.message}`),
    );
  }

  private async sendResetLink(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;
    if (!(await this.cooldown(`reset:${user.id}`))) return;
    const token = await this.createToken(user.id, AuthTokenType.PASSWORD_RESET);
    this.mail.sendPasswordReset({
      email: user.email,
      name: user.name,
      url: this.link("/reset-password", token),
    });
  }

  /** Sets the new password and signs the user out everywhere. */
  async resetPassword(rawToken: string, password: string): Promise<void> {
    const { userId } = await this.consume(rawToken, AuthTokenType.PASSWORD_RESET);
    const user = await this.users.findById(userId);
    await this.users.update(userId, {
      passwordHash: await hashPassword(password),
      // Receiving the email proves they own the address.
      emailVerifiedAt: user?.emailVerifiedAt ?? new Date(),
    });
    await this.tokens.revokeAllForUser(userId);
    // Owning the inbox lifts a pause caused by someone else's failed guesses.
    if (user) await this.attempts.reset(user.email);
  }

  /** Invalidate every outstanding verification / reset link of a user. */
  async discardPendingTokens(userId: string): Promise<void> {
    await this.prisma.authToken.deleteMany({ where: { userId, usedAt: null } });
  }

  /** New token; earlier unused tokens of the same kind stop working. */
  private async createToken(userId: string, type: AuthTokenType): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    const ttl =
      type === AuthTokenType.PASSWORD_RESET
        ? this.config.get("PASSWORD_RESET_TTL")
        : this.config.get("EMAIL_VERIFICATION_TTL");
    await this.prisma.$transaction([
      this.prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
      this.prisma.authToken.create({
        data: {
          userId,
          type,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      }),
    ]);
    return raw;
  }

  /** Single use: marks the token used atomically, so two requests can't both redeem it. */
  private async consume(rawToken: string, type: AuthTokenType) {
    const tokenHash = sha256(rawToken);
    const { count } = await this.prisma.authToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw invalidLink();
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash } });
    if (!token) throw invalidLink();
    return token;
  }

  private link(path: string, token: string) {
    const url = new URL(path, this.config.get("APP_URL"));
    url.searchParams.set("token", token);
    return url.toString();
  }

  /** True if this action may run now (at most once per EMAIL_COOLDOWN). Fails open. */
  private async cooldown(key: string): Promise<boolean> {
    try {
      return (await this.redis.set(`cooldown:${key}`, "1", "EX", EMAIL_COOLDOWN, "NX")) === "OK";
    } catch {
      return true;
    }
  }
}
