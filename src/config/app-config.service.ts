import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./env.js";

/** Typed access to the validated environment. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction() {
    return this.get("NODE_ENV") === "production";
  }

  get metricsEnabled() {
    return this.get("METRICS_ENABLED") ?? (!!this.get("METRICS_TOKEN") || !this.isProduction);
  }

  get swaggerEnabled() {
    return this.get("SWAGGER_ENABLED") ?? !this.isProduction;
  }
}
