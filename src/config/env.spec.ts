import { validateEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  JWT_SECRET: "x".repeat(32),
};

describe("validateEnv", () => {
  it("applies defaults that match base-frontend", () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.REFRESH_TOKEN_TTL).toBe(60 * 60 * 24 * 30);
    expect(env.GOOGLE_CLIENT_ID).toEqual([]);
  });

  it("parses comma-separated lists and booleans", () => {
    const env = validateEnv({
      ...base,
      GOOGLE_CLIENT_ID: "a.apps.googleusercontent.com, b.apps.googleusercontent.com",
      SWAGGER_ENABLED: "false",
    });
    expect(env.GOOGLE_CLIENT_ID).toEqual([
      "a.apps.googleusercontent.com",
      "b.apps.googleusercontent.com",
    ]);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it("rejects a short JWT secret with a readable message", () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("requires DATABASE_URL", () => {
    expect(() => validateEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });

  describe("in production", () => {
    const prod = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:S3cure-Pa55@db:5432/app",
      JWT_SECRET: "k2J9v0bq7XwYc8Lr5TzN1aHd4FgE6sPu3mQiOyRt",
    };

    it("accepts real secrets", () => {
      expect(validateEnv(prod).NODE_ENV).toBe("production");
    });

    it("rejects the example JWT secret", () => {
      expect(() =>
        validateEnv({
          ...prod,
          JWT_SECRET: "change-me-to-a-long-random-string-of-at-least-32-chars",
        }),
      ).toThrow(/JWT_SECRET: is an example value/);
    });

    it("rejects default database passwords", () => {
      expect(() =>
        validateEnv({ ...prod, DATABASE_URL: "postgresql://app:app@db:5432/app" }),
      ).toThrow(/DATABASE_URL: uses a default\/weak database password/);
    });

    it("allows the dev defaults outside production", () => {
      expect(() =>
        validateEnv({
          DATABASE_URL: "postgresql://app:app@localhost:5432/app",
          JWT_SECRET: "change-me-to-a-long-random-string-of-at-least-32-chars",
        }),
      ).not.toThrow();
    });
  });
});
