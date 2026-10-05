import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

/** Prometheus registry: Node process metrics + HTTP request durations. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    // `route` is the matched pattern (/projects/:id), never the raw URL, to keep cardinality low.
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
