import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Identity taken from a verified access token. */
export interface AuthUser {
  id: string;
  email: string;
  /** Session (refresh-token family) the access token belongs to. */
  sessionId?: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

/** Injects the authenticated user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user!;
});
