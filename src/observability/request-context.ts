import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "../common/decorators/current-user.decorator.js";
import type { AppConfig } from "../config/app-config.service.js";
import type { MetricsService } from "./metrics.service.js";

export type RequestWithContext = Request & { id?: string; user?: AuthUser };

const REQUEST_ID = /^[\w.:-]{1,128}$/;
const QUIET = new Set(["/health", "/health/live", "/metrics"]);

/**
 * Per-request context:
 * - request id: reuses a sane incoming `X-Request-Id` (e.g. from your proxy or the
 *   frontend), otherwise generates one; echoed in the response header and in logs.
 * - one structured access-log line per request (health/metrics only at debug level).
 * - Prometheus request-duration metric.
 */
export function requestContext(metrics: MetricsService, config: AppConfig) {
  const logger = new Logger("HTTP");
  const ipMode = config.get("LOG_CLIENT_IP") ?? (config.isProduction ? "masked" : "full");

  return (req: RequestWithContext, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id");
    req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.id);
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
      metrics.httpDuration.observe(
        { method: req.method, route, status_code: String(res.statusCode) },
        seconds,
      );

      const path = req.originalUrl.split("?")[0]!;
      const entry = {
        requestId: req.id,
        ip: ipMode === "off" ? undefined : ipMode === "masked" ? maskIp(req.ip) : req.ip,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
        userId: req.user?.id,
      };
      const message = `${req.method} ${path} ${res.statusCode} ${entry.durationMs}ms`;
      if (QUIET.has(path)) logger.debug(message, entry);
      else if (res.statusCode >= 500) logger.error(message, entry);
      else if (res.statusCode >= 400) logger.warn(message, entry);
      else logger.log(message, entry);
    });

    next();
  };
}

/** 203.0.113.42 → 203.0.113.0 · 2001:db8:abcd:12::1 → 2001:db8:abcd:: */
export function maskIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, ".0");
  const groups = ip.split("::")[0]!.split(":").slice(0, 3);
  return `${groups.join(":")}::`;
}
