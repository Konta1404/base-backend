import { Global, Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { AppConfig } from "../config/app-config.service.js";
import { REDIS } from "./redis.constants.js";

/**
 * One shared ioredis connection for cache and rate limiting.
 * (BullMQ opens its own connections from the same REDIS_URL.)
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: async (config: AppConfig) => {
        const logger = new Logger("Redis");
        const client = new Redis(config.get("REDIS_URL"), {
          // While Redis is down, fail commands immediately (callers fail open)
          // instead of queueing them and stalling requests.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 5_000,
          retryStrategy: (times) => Math.min(times * 200, 2_000),
        });
        let wasReady = false;
        client.on("ready", () => {
          wasReady = true;
          logger.log("Connected");
        });
        client.on("error", (err: Error) => {
          // ioredis reconnects on its own; log once per outage, not on every retry.
          if (wasReady) logger.error(`Connection lost: ${err.message}`);
          wasReady = false;
        });
        // Give Redis a moment at boot so the first requests don't all fail open,
        // but never block startup on it.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            logger.warn("Not reachable yet; starting anyway (cache and rate limits fail open)");
            resolve();
          }, 5_000);
          client.once("ready", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
