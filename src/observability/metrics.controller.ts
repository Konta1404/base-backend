import { timingSafeEqual } from "node:crypto";
import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator.js";
import { AppConfig } from "../config/app-config.service.js";
import { MetricsService } from "./metrics.service.js";

const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Prometheus scrape endpoint. Protect it with METRICS_TOKEN (or block /metrics at
 * your proxy) — it reveals traffic patterns.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async scrape(@Headers("authorization") authorization?: string) {
    if (!this.config.metricsEnabled) throw new NotFoundException();
    const token = this.config.get("METRICS_TOKEN");
    if (token && !sameSecret(authorization ?? "", `Bearer ${token}`)) {
      throw new UnauthorizedException("Unauthorized");
    }
    return this.metrics.registry.metrics();
  }
}
