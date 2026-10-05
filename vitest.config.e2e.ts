import { defineConfig } from "vitest/config";
import { testDatabaseUrl, testRedisUrl } from "./test/test-env.js";

// e2e tests boot the real app against real Postgres and Redis — but always a
// separate *_test database and Redis db 15 (see test/test-env.ts), created and
// migrated automatically by test/global-setup.ts.
export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.e2e-spec.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: testRedisUrl(),
      JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
      AUTH_THROTTLE_LIMIT: "5",
      AUTH_IP_THROTTLE_LIMIT: "20",
      AUTH_ACCOUNT_FAILURE_LIMIT: "8",
      TRUST_PROXY: "loopback",
      REFRESH_REUSE_GRACE: "2",
      GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
      SWAGGER_ENABLED: "false",
      METRICS_TOKEN: "e2e-metrics-token-e2e",
      LOG_LEVEL: "warn",
    },
  },
});
