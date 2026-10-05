import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { AppConfig } from "../config/app-config.service.js";

/**
 * BullMQ root config (Redis connection + job defaults). Feature modules register
 * their own queues with `BullModule.registerQueue({ name })` — see MailModule.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.get("REDIS_URL") },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          // Bounded history for debugging. Jobs carrying secrets must opt out per job
          // (see MailService) — job data sits in Redis in plain text.
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 5_000 },
        },
      }),
    }),
  ],
})
export class QueueModule {}
