import { Redis } from "ioredis";
import { RedisThrottlerStorage } from "../src/common/redis-throttler.storage.js";

describe("RedisThrottlerStorage", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const storage = new RedisThrottlerStorage(redis);
  const key = `test-${Date.now()}`;

  afterAll(async () => {
    const keys = await redis.keys(`throttle:t:${key}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("counts hits in a window and blocks over the limit", async () => {
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await storage.increment(key, 60_000, 3, 5_000, "t"));

    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3, 4]);
    expect(hits.slice(0, 3).every((h) => !h.isBlocked)).toBe(true);
    expect(hits[3]).toMatchObject({ isBlocked: true, timeToBlockExpire: 5 });
    expect(hits[0]!.timeToExpire).toBeGreaterThan(55);

    // Still blocked while the block key lives.
    expect((await storage.increment(key, 60_000, 3, 5_000, "t")).isBlocked).toBe(true);
  });

  it("keeps separate counters per key", async () => {
    const other = await storage.increment(`${key}-other`, 60_000, 3, 5_000, "t");
    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
