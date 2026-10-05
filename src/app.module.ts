import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module.js";
import { CacheModule } from "./cache/cache.module.js";
import { AppThrottlerGuard } from "./common/app-throttler.guard.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";
import { SecurityModule } from "./common/security.module.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { throttlerOptions } from "./common/throttle.js";
import { AppConfig } from "./config/app-config.service.js";
import { AppConfigModule } from "./config/config.module.js";
import { HealthController } from "./health/health.controller.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { REDIS } from "./redis/redis.constants.js";
import { RedisModule } from "./redis/redis.module.js";
import { UsersModule } from "./users/users.module.js";

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    SecurityModule,
    ObservabilityModule,
    CacheModule,
    QueueModule,
    ThrottlerModule.forRootAsync({ inject: [AppConfig, REDIS], useFactory: throttlerOptions }),
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit first, then authenticate.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
