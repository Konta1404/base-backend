import type { Redis } from "ioredis";
import { Logger } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.service.js";
import { CacheService } from "./cache.service.js";

const config = { get: () => 60 } as unknown as AppConfig;

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    del: vi.fn(async (...ks: string[]) => ks.forEach((k) => store.delete(k))),
  };
}

describe("CacheService", () => {
  it("wrap computes once, then serves from cache", async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as Redis, config);
    const compute = vi.fn(async () => ({ id: "1" }));

    expect(await cache.wrap("k", compute)).toEqual({ id: "1" });
    expect(await cache.wrap("k", compute)).toEqual({ id: "1" });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith("cache:k", '{"id":"1"}', "EX", 60, "NX");
  });

  it("never lets a slow reader overwrite a value written meanwhile", async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as Redis, config);
    const result = await cache.wrap("user", async () => {
      await cache.set("user", { name: "new" }); // a writer updates while we read the old row
      return { name: "old" };
    });
    expect(result).toEqual({ name: "old" });
    expect(await cache.get("user")).toEqual({ name: "new" });
  });

  it("can cache an explicit null (e.g. deleted)", async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as Redis, config);
    await cache.set("gone", null);
    const compute = vi.fn(async () => ({ id: "stale" }));
    expect(await cache.wrap("gone", compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });

  it("does not cache null", async () => {
    const redis = fakeRedis();
    const cache = new CacheService(redis as unknown as Redis, config);
    await cache.wrap("missing", async () => null);
    expect(redis.store.size).toBe(0);
  });

  it("fails open when Redis is down", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const cache = new CacheService({ get: down, set: down, del: down } as unknown as Redis, config);
    await expect(cache.wrap("k", async () => "fresh")).resolves.toBe("fresh");
    await expect(cache.del("k")).resolves.toBeUndefined();
  });
});
