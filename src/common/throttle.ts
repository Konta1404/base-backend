import type { ExecutionContext } from "@nestjs/common";
import type { ThrottlerModuleOptions } from "@nestjs/throttler";
import type { Request } from "express";
import type { Redis } from "ioredis";
import type { AppConfig } from "../config/app-config.service.js";
import { CREDENTIAL_RATE_LIMIT_KEY } from "./decorators/credential-rate-limit.decorator.js";
import { RedisThrottlerStorage } from "./redis-throttler.storage.js";

const isCredentialRoute = (ctx: ExecutionContext) =>
  Reflect.getMetadata(CREDENTIAL_RATE_LIMIT_KEY, ctx.getHandler()) === true;

const clientIp = (req: Record<string, unknown>) => (req as unknown as Request).ip ?? "unknown";

const submittedEmail = (req: Record<string, unknown>) => {
  const body = ((req as unknown as Request).body ?? {}) as { email?: unknown };
  return typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
};

/**
 * Two limits, both stored in Redis:
 *
 * - `default` — every route: THROTTLE_LIMIT per client IP. On credential routes
 *   (@CredentialRateLimit) it switches to AUTH_THROTTLE_LIMIT per client IP + email.
 *   (Not per email alone: then anyone could lock a user out with a few requests.
 *   Slow guessing of one account from many IPs is handled by LoginAttemptsService,
 *   which counts only *failed* logins.)
 * - `auth-ip` — credential routes only: AUTH_IP_THROTTLE_LIMIT per client IP across
 *   all emails, so one IP can't try a few passwords against thousands of accounts.
 *
 * "Client IP" is `req.ip`, which honours TRUST_PROXY — base-frontend forwards the
 * browser's IP in X-Forwarded-For, otherwise every user would share the frontend's IP.
 */
export function throttlerOptions(config: AppConfig, redis: Redis): ThrottlerModuleOptions {
  const ttl = config.get("THROTTLE_TTL") * 1000;
  return {
    storage: new RedisThrottlerStorage(redis),
    throttlers: [
      {
        name: "default",
        ttl,
        limit: (ctx) =>
          isCredentialRoute(ctx) ? config.get("AUTH_THROTTLE_LIMIT") : config.get("THROTTLE_LIMIT"),
        getTracker: (req, ctx) =>
          isCredentialRoute(ctx) ? `${clientIp(req)}|${submittedEmail(req)}` : clientIp(req),
      },
      {
        name: "auth-ip",
        ttl,
        limit: config.get("AUTH_IP_THROTTLE_LIMIT"),
        skipIf: (ctx) => !isCredentialRoute(ctx),
        getTracker: (req) => clientIp(req),
      },
    ],
    errorMessage: "Too many requests. Please wait a moment and try again.",
  };
}
