import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator.js";
import type { AuthenticatedRequest } from "../decorators/current-user.decorator.js";
import { SessionRevocationService } from "../session-revocation.service.js";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Session id (refresh-token family); lets logout revoke the access token too. */
  sid?: string;
}

/**
 * Global guard: every route requires `Authorization: Bearer <access token>`
 * unless it is marked with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly revocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("Unauthorized");

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException("Unauthorized");
    }
    if (payload.sid && (await this.revocation.isRevoked(payload.sid))) {
      throw new UnauthorizedException("Unauthorized");
    }
    req.user = { id: payload.sub, email: payload.email, sessionId: payload.sid };
    return true;
  }
}
