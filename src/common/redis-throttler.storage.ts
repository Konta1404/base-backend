import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { Redis } from "ioredis";
import { REDIS } from "../redis/redis.constants.js";

// Atomic fixed-window counter with optional block period.
// KEYS: hits key, block key · ARGV: ttl ms, limit, block ms
// Returns: { totalHits, msToExpire, isBlocked (0/1), msToBlockExpire }
const INCREMENT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  local block = tonumber(ARGV[3])
  if block > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', block)
    return { hits, ttl, 1, block }
  end
  return { hits, ttl, 1, ttl }
end
return { hits, ttl, 0, 0 }
`;

/**
 * Stores @nestjs/throttler counters in Redis, so limits hold across every API
 * instance (the default storage is per-process memory).
 *
 * Fails open: if Redis is unreachable, requests are allowed (and a warning is
 * logged) rather than taking the whole API down with it.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarning = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    try {
      return await this.hit(key, ttl, limit, blockDuration, name);
    } catch (err) {
      if (Date.now() - this.lastWarning > 30_000) {
        this.lastWarning = Date.now();
        this.logger.warn(`Rate limiting disabled, Redis unavailable: ${(err as Error).message}`);
      }
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  private async hit(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    const base = `throttle:${name}:${key}`;
    const [totalHits, msToExpire, blocked, msToBlockExpire] = (await this.redis.eval(
      INCREMENT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(msToExpire / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(msToBlockExpire / 1000),
    };
  }
}
