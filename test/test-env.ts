/**
 * Where e2e tests run. They truncate tables and delete keys, so they never use
 * your dev data:
 *   - Postgres: TEST_DATABASE_URL, or DATABASE_URL with "_test" appended to the
 *     database name (app -> app_test). Refuses any database not ending in _test.
 *   - Redis: TEST_REDIS_URL, or REDIS_URL switched to logical database 15.
 */
import "dotenv/config";

export function testDatabaseUrl(): string {
  const raw =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://app:app@localhost:5432/app";
  const url = new URL(raw);
  if (!process.env.TEST_DATABASE_URL) {
    const name = url.pathname.replace(/^\//, "") || "app";
    if (!name.endsWith("_test")) url.pathname = `/${name}_test`;
  }
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run e2e tests against "${name}": the database name must end with "_test".`,
    );
  }
  return url.toString();
}

export function testRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = "/15";
  return url.toString();
}
