import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type User } from "../generated/prisma/client.js";
import type { PublicUser } from "../users/user.entity.js";
import { MailService } from "../mail/mail.service.js";
import { UsersService } from "../users/users.service.js";
import type { AuthResponse, LoginDto, RegisterDto } from "./dto/auth.dto.js";
import { AccountService } from "./account.service.js";
import { LoginAttemptsService } from "./login-attempts.service.js";
import { type GoogleIdentity, GoogleVerifier } from "./google-verifier.service.js";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly google: GoogleVerifier,
    private readonly mail: MailService,
    private readonly account: AccountService,
    private readonly attempts: LoginAttemptsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    if (await this.users.findByEmail(dto.email)) throw this.emailTaken();
    let user: User;
    try {
      user = await this.users.create({
        email: dto.email,
        name: dto.name,
        passwordHash: await hashPassword(dto.password),
      });
    } catch (err) {
      // Lost a race with a concurrent registration for the same email.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw this.emailTaken();
      }
      throw err;
    }
    this.mail.sendWelcome({
      email: user.email,
      name: user.name,
      verifyUrl: await this.account.verificationUrl(user),
    });
    return this.tokens.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    if (await this.attempts.isLocked(dto.email)) {
      throw new HttpException(
        "Too many failed sign-in attempts for this account. Try again later or reset your password.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.users.findByEmail(dto.email);
    // Always run a hash comparison so response time doesn't reveal whether the email exists.
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user?.passwordHash || !ok) {
      await this.attempts.recordFailure(dto.email);
      throw new UnauthorizedException("Invalid email or password.");
    }
    await this.attempts.reset(dto.email);
    return this.tokens.issue(user);
  }

  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    const identity = await this.google.verify(idToken);

    let user = await this.users.findByGoogleId(identity.googleId);
    if (!user) {
      const existing = await this.users.findByEmail(identity.email);
      if (existing) {
        user = await this.linkGoogle(existing, identity);
      } else {
        user = await this.users.create({
          email: identity.email,
          googleId: identity.googleId,
          name: identity.name,
          avatarUrl: identity.picture,
          emailVerifiedAt: new Date(),
        });
        this.mail.sendWelcome({ email: user.email, name: user.name });
      }
    }
    return this.tokens.issue(user);
  }

  /**
   * Attach a Google identity to an account that already uses its email.
   *
   * Google has proven the caller owns the inbox. If the existing account never
   * proved that, anyone could have registered it with someone else's address
   * ("pre-account takeover"): the verified owner wins, so the unproven password
   * is removed and every existing session is signed out. A legitimate owner who
   * simply never verified can set a new password with forgot-password.
   */
  private async linkGoogle(existing: User, identity: GoogleIdentity): Promise<User> {
    if (existing.emailVerifiedAt) {
      // Both sides proved ownership of the same inbox: safe to link and keep the password.
      return this.users.update(existing.id, {
        googleId: identity.googleId,
        name: existing.name ?? identity.name,
        avatarUrl: existing.avatarUrl ?? identity.picture,
      });
    }

    // Order matters: remove the password first, so no new session can be created
    // with it after the revocation below.
    const user = await this.users.update(existing.id, {
      googleId: identity.googleId,
      passwordHash: null,
      emailVerifiedAt: new Date(),
      // Profile fields were set by whoever registered; prefer what Google vouches for.
      name: identity.name ?? existing.name,
      avatarUrl: identity.picture ?? existing.avatarUrl,
    });
    await this.tokens.revokeAllForUser(existing.id);
    await this.account.discardPendingTokens(existing.id);
    return user;
  }

  refresh(refreshToken: string): Promise<AuthResponse> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.getPublicById(userId);
    if (!user) throw new UnauthorizedException("Unauthorized");
    return user;
  }

  /** Full account deletion: ends every session (incl. live access tokens), then deletes. */
  async deleteAccount(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.users.remove(userId);
  }

  private emailTaken() {
    return new ConflictException("An account with this email already exists.");
  }
}
