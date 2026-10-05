import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { REDIS } from "../redis/redis.constants.js";
import { normalizeEmail } from "../users/users.service.js";

/**
 * Per-account failed-login counter (Redis), the defence against guessing one
 * account's password slowly from many IPs.
 *
 * Only failures count, and success resets the counter, so the owner's normal use
 * never trips it. An attacker *can* pause password login for an account by failing
 * AUTH_ACCOUNT_FAILURE_LIMIT times within the window — at a much higher cost than a
 * rate limit keyed on the email alone — and the owner can always get back in with a
 * password reset (which clears the counter) or Google. Fails open without Redis.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  async isLocked(email: string): Promise<boolean> {
    try {
      const failures = Number((await this.redis.get(this.key(email))) ?? 0);
      return failures >= this.config.get("AUTH_ACCOUNT_FAILURE_LIMIT");
    } catch {
      return false;
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      const key = this.key(email);
      const [[, failures]] = (await this.redis
        .multi()
        .incr(key)
        .expire(key, this.config.get("AUTH_ACCOUNT_FAILURE_WINDOW"), "NX")
        .exec()) as [[Error | null, number]];
      if (failures === this.config.get("AUTH_ACCOUNT_FAILURE_LIMIT")) {
        this.logger.warn("Password login paused for an account after repeated failures", {
          account: this.key(email).slice(-12),
        });
      }
    } catch {
      // Fail open.
    }
  }

  async reset(email: string): Promise<void> {
    try {
      await this.redis.del(this.key(email));
    } catch {
      // Fail open.
    }
  }

  /** Hashed so Redis keys don't list email addresses. */
  private key(email: string) {
    return `login-failures:${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
  }
}
