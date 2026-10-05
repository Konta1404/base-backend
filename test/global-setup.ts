import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-env.js";

/** Creates the e2e database if needed and applies migrations, once per test run. */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const database = url.pathname.replace(/^\//, "");

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database,
    ]);
    if (!rowCount) await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "inherit",
  });
}
