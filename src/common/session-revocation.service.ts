import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { REDIS } from "../redis/redis.constants.js";

const key = (sessionId: string) => `revoked:session:${sessionId}`;

/**
 * Makes access tokens revocable. Every access token carries the id of its
 * session (`sid` = refresh-token family). Revoking a session writes a Redis key
 * that lives exactly as long as an access token can, and JwtAuthGuard rejects
 * tokens whose session is listed.
 *
 * Fails open: if Redis is unreachable, tokens are accepted until they expire
 * (at most JWT_ACCESS_TTL), and a warning is logged.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);
  private lastWarning = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  async revoke(...sessionIds: string[]): Promise<void> {
    if (!sessionIds.length) return;
    const ttl = this.config.get("JWT_ACCESS_TTL");
    try {
      const pipeline = this.redis.pipeline();
      for (const id of sessionIds) pipeline.set(key(id), "1", "EX", ttl);
      await pipeline.exec();
    } catch (err) {
      this.warn(err);
    }
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key(sessionId))) === 1;
    } catch (err) {
      this.warn(err);
      return false;
    }
  }

  private warn(err: unknown) {
    if (Date.now() - this.lastWarning < 30_000) return;
    this.lastWarning = Date.now();
    this.logger.warn(`Session revocation unavailable (Redis): ${(err as Error).message}`);
  }
}
