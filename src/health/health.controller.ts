import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator.js";
import type { Redis } from "ioredis";
import { PrismaService } from "../prisma/prisma.service.js";
import { REDIS } from "../redis/redis.constants.js";

@ApiTags("health")
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Readiness: the API can serve requests (database and Redis reachable). */
  @Get()
  @ApiOkResponse({ schema: { example: { status: "ok", database: "up", redis: "up" } } })
  @ApiServiceUnavailableResponse()
  async check() {
    const [database, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => "up" as const,
        () => "down" as const,
      ),
      this.redis.ping().then(
        () => "up" as const,
        () => "down" as const,
      ),
    ]);
    if (database === "down" || redis === "down") {
      throw new ServiceUnavailableException(
        [database === "down" && "Database", redis === "down" && "Redis"]
          .filter(Boolean)
          .join(" and ") + " unavailable.",
      );
    }
    return { status: "ok", database, redis };
  }

  /** Liveness: the process is up. Used by the Docker HEALTHCHECK. */
  @Get("live")
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  live() {
    return { status: "ok" };
  }
}
