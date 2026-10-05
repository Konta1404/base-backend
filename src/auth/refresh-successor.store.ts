import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { REDIS } from "../redis/redis.constants.js";

export type SuccessorLookup =
  { status: "hit"; refreshToken: string } | { status: "miss" } | { status: "unavailable" };

/**
 * Remembers, for REFRESH_REUSE_GRACE seconds, which refresh token replaced which.
 * A concurrent duplicate refresh then gets *the same* successor back instead of
 * a second live token, so a replayed (stolen) token can't fork the session.
 *
 * The successor is a live credential, so it is stored AES-256-GCM encrypted with a
 * key derived from JWT_SECRET — reading Redis alone doesn't reveal it.
 */
@Injectable()
export class RefreshSuccessorStore {
  private readonly key: Buffer;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: AppConfig,
  ) {
    this.key = createHash("sha256")
      .update(`refresh-successor:${config.get("JWT_SECRET")}`)
      .digest();
  }

  async remember(oldTokenHash: string, successor: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      await this.redis.set(this.redisKey(oldTokenHash), this.encrypt(successor), "EX", ttlSeconds);
    } catch {
      // Redis down: rotate() falls back to issuing a fresh token (fail open).
    }
  }

  async recall(oldTokenHash: string): Promise<SuccessorLookup> {
    let stored: string | null;
    try {
      stored = await this.redis.get(this.redisKey(oldTokenHash));
    } catch {
      return { status: "unavailable" };
    }
    if (!stored) return { status: "miss" };
    try {
      return { status: "hit", refreshToken: this.decrypt(stored) };
    } catch {
      return { status: "miss" };
    }
  }

  private redisKey(oldTokenHash: string) {
    return `refresh:successor:${oldTokenHash}`;
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }

  private decrypt(stored: string): string {
    const raw = Buffer.from(stored, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
