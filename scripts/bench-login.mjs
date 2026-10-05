#!/usr/bin/env node
/**
 * Login load test: how many password checks per second can one API instance do?
 *
 *   node scripts/bench-login.mjs [--url http://localhost:4000] [--concurrency 16] [--seconds 10]
 *
 * Each request uses a fresh unknown email and client IP (X-Forwarded-For), so the
 * per-email and per-IP rate limits don't turn the run into 429s; unknown emails cost
 * the same full password hash as real ones (the API hashes a dummy to keep timing
 * flat), so 401s measure exactly the work a login does. Requires the API to trust
 * your address (the default TRUST_PROXY trusts loopback and private networks).
 * Run it against dev/staging, never production.
 *
 * Password hashing (scrypt) runs on libuv's thread pool, so throughput scales with
 * UV_THREADPOOL_SIZE up to your CPU count — compare runs with different values.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4000" },
    concurrency: { type: "string", default: "16" },
    seconds: { type: "string", default: "10" },
  },
});
const concurrency = Number(values.concurrency);
const deadline = Date.now() + Number(values.seconds) * 1000;
const latencies = [];
const statuses = new Map();
let n = 0;

async function worker() {
  while (Date.now() < deadline) {
    const i = n++;
    const start = performance.now();
    const res = await fetch(`${values.url}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      },
      body: JSON.stringify({ email: `bench-${i}@example.invalid`, password: "not-the-password" }),
    }).catch(() => ({ status: "network-error" }));
    latencies.push(performance.now() - start);
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
const seconds = Number(values.seconds);
console.log(
  `requests: ${latencies.length} in ${seconds}s → ${(latencies.length / seconds).toFixed(1)} logins/s`,
);
console.log(
  `latency ms: p50 ${pct(0.5).toFixed(0)} · p95 ${pct(0.95).toFixed(0)} · p99 ${pct(0.99).toFixed(0)}`,
);
console.log("statuses:", Object.fromEntries(statuses));
if (statuses.has(429))
  console.log("note: 429s mean the rate limiter kicked in (check TRUST_PROXY / limits).");
