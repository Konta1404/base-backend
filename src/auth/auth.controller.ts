import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { CredentialRateLimit } from "../common/decorators/credential-rate-limit.decorator.js";
import { CurrentUser, type AuthUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { PublicUser } from "../users/user.entity.js";
import { AccountService } from "./account.service.js";
import { AuthService } from "./auth.service.js";
import {
  AuthResponse,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
} from "./dto/auth.dto.js";

/** Implements the backend contract documented in base-frontend's README. */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @Public()
  @CredentialRateLimit()
  @Post("register")
  @ApiCreatedResponse({ type: AuthResponse })
  @ApiConflictResponse({ description: "Email already registered" })
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Public()
  @CredentialRateLimit()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponse })
  @ApiUnauthorizedResponse({ description: "Invalid credentials" })
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Public()
  @Post("google")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponse })
  @ApiUnauthorizedResponse({ description: "Invalid or unverified Google ID token" })
  google(@Body() dto: GoogleAuthDto): Promise<AuthResponse> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  // Refresh tokens are 256-bit random values, so guessing isn't a concern; skipping the
  // throttler keeps a busy frontend (all users behind one IP) from being rate limited.
  @Public()
  @SkipThrottle()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponse })
  @ApiUnauthorizedResponse({ description: "Invalid, expired or reused refresh token" })
  refresh(@Body() dto: RefreshDto): Promise<AuthResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  // Public on purpose: the access token may already be expired at sign-out, and
  // possession of the refresh token is enough to end its own session.
  @Public()
  @SkipThrottle()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get("me")
  @SkipThrottle()
  @ApiBearerAuth()
  @ApiOkResponse({ type: PublicUser })
  @ApiUnauthorizedResponse()
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  // --- Email verification -----------------------------------------------------
  // Links in emails point to the frontend (APP_URL/verify-email?token=…), which
  // posts the token here.

  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: "Invalid, used or expired link" })
  async verifyEmail(@Body() dto: TokenDto): Promise<void> {
    await this.account.verifyEmail(dto.token);
  }

  @Post("verify-email/resend")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiAcceptedResponse({ description: "Sent, unless already verified or sent in the last minute" })
  async resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    await this.account.resendVerification(user.id);
  }

  // --- Password reset -----------------------------------------------------------

  @Public()
  @CredentialRateLimit()
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: "Always 202, whether or not the account exists" })
  forgotPassword(@Body() dto: ForgotPasswordDto): void {
    this.account.requestPasswordReset(dto.email);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Password changed; all sessions signed out" })
  @ApiBadRequestResponse({ description: "Invalid, used or expired link" })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.account.resetPassword(dto.token, dto.password);
  }
}
