import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { REDIS } from "../redis/redis.constants.js";

const PREFIX = "cache:";

// KEYS: value key, version key · ARGV: json, version, ttl seconds
const SET_IF_NEWER = `
local current = tonumber(redis.call('GET', KEYS[2]) or '-1')
if current > tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
`;

/**
 * JSON cache on Redis. Fails open: if Redis is unavailable, reads miss and
 * writes are skipped, so the app keeps working straight from the database.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.warn("get", key, err);
      return undefined;
    }
  }

  /** `ttl` in seconds; defaults to CACHE_TTL. */
  async set(key: string, value: unknown, ttl = this.config.get("CACHE_TTL")): Promise<void> {
    try {
      await this.redis.set(PREFIX + key, JSON.stringify(value), "EX", ttl);
    } catch (err) {
      this.warn("set", key, err);
    }
  }

  /**
   * Write `value` unless a newer version is already cached (`version` must grow with
   * every change, e.g. a row's updatedAt). Two concurrent writers can't leave the older
   * value behind, whatever order their cache writes land in.
   */
  async setVersioned(
    key: string,
    value: unknown,
    version: number,
    ttl = this.config.get("CACHE_TTL"),
  ): Promise<void> {
    try {
      await this.redis.eval(
        SET_IF_NEWER,
        2,
        PREFIX + key,
        `${PREFIX}${key}:version`,
        JSON.stringify(value),
        version,
        ttl,
      );
    } catch (err) {
      this.warn("set", key, err);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.redis.del(...keys.flatMap((k) => [PREFIX + k, `${PREFIX}${k}:version`]));
    } catch (err) {
      this.warn("del", keys.join(","), err);
    }
  }

  /**
   * Read-through cache: return the cached value, or compute, store and return it.
   * `null` / `undefined` results are not cached.
   *
   * The fill uses SET NX, so it never overwrites a value a writer stored meanwhile.
   * Writers should `setVersioned` the fresh value (or null on delete) rather than
   * `del`, which closes the race where a slow reader puts stale data back:
   *   reader reads old row → writer updates row + sets new value → reader's NX fill is a no-op.
   */
  async wrap<T>(key: string, compute: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    if (value !== null && value !== undefined) await this.fill(key, value, ttl);
    return value;
  }

  private async fill(key: string, value: unknown, ttl = this.config.get("CACHE_TTL")) {
    try {
      await this.redis.set(PREFIX + key, JSON.stringify(value), "EX", ttl, "NX");
    } catch (err) {
      this.warn("set", key, err);
    }
  }

  private warn(op: string, key: string, err: unknown) {
    this.logger.warn(`cache ${op} failed for "${key}": ${(err as Error).message}`);
  }
}
