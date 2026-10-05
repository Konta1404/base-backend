import { BlockList, isIP } from "node:net";
import { type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { CREDENTIAL_RATE_LIMIT_KEY } from "./decorators/credential-rate-limit.decorator.js";

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addAddress("::1", "ipv6");

function isPrivate(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const family = isIP(v4);
  return family !== 0 && PRIVATE.check(v4, family === 4 ? "ipv4" : "ipv6");
}

/**
 * ThrottlerGuard that explains the most likely misconfiguration: the per-IP login
 * limit tripping for a *private* address usually means a backend-for-frontend
 * (base-frontend, another server) isn't forwarding the browser's IP, so every
 * user shares one bucket.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly hintLogger = new Logger("RateLimit");
  private lastHint = 0;

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const credentialRoute =
      Reflect.getMetadata(CREDENTIAL_RATE_LIMIT_KEY, context.getHandler()) === true;
    const perIpBucket = !detail.tracker.includes("|");
    if (credentialRoute && perIpBucket && isPrivate(detail.tracker)) {
      if (Date.now() - this.lastHint > 5 * 60_000) {
        this.lastHint = Date.now();
        this.hintLogger.warn(
          `Login rate limit hit for private address ${detail.tracker}. If that's your frontend ` +
            "server, it isn't forwarding the browser's IP (X-Forwarded-For) and all users share " +
            "one limit — see TRUST_PROXY in the README.",
        );
      }
    }
    return super.throwThrottlingException(context, detail);
  }
}
