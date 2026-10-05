import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const list = z.string().transform((v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Values that ship in .env.example / docker-compose.yml for local development.
 * Production refuses to start with them (see the refinement below).
 */
const EXAMPLE_SECRETS = [
  "change-me-to-a-long-random-string-of-at-least-32-chars",
  "dev-only-secret-change-me-dev-only-secret-change-me",
  "e2e-secret-e2e-secret-e2e-secret-e2e",
];
const WEAK_DB_PASSWORDS = ["", "app", "postgres", "password", "changeme", "secret"];

function databasePassword(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return undefined;
  }
}

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** Redis for cache, shared rate limits and background jobs. */
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  /** Default cache TTL in seconds. */
  CACHE_TTL: z.coerce.number().int().positive().default(300),

  /** Public URL of the frontend; used to build links in emails (verify email, reset password). */
  APP_URL: z.url().default("http://localhost:3000"),
  /** Email verification link lifetime in seconds (default 24 h). */
  EMAIL_VERIFICATION_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  /** Password reset link lifetime in seconds (default 1 h). */
  PASSWORD_RESET_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  /** `json` (one object per line, for log collectors) or `pretty`. Defaults to json in production. */
  LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
  LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
  /**
   * Client IPs in request logs (personal data under GDPR): `full`, `masked` (IPv4 /24,
   * IPv6 /48) or `off`. Defaults to masked in production, full otherwise.
   */
  LOG_CLIENT_IP: z.enum(["full", "masked", "off"]).optional(),
  /**
   * Prometheus metrics at GET /metrics. Default: on outside production; in production
   * only when METRICS_TOKEN is set (set METRICS_ENABLED=true to expose them without a
   * token, e.g. when /metrics is blocked at your proxy).
   */
  METRICS_ENABLED: bool.optional(),
  /** If set, /metrics requires `Authorization: Bearer <METRICS_TOKEN>`. */
  METRICS_TOKEN: z.string().min(16).optional(),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Access token lifetime in seconds (returned to the frontend as `expiresIn`). */
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_ISSUER: z.string().min(1).default("base-backend"),
  /** Refresh token lifetime in seconds. Matches the frontend's 30-day refresh cookie. */
  REFRESH_TOKEN_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  /**
   * Seconds during which an already-rotated refresh token may be presented again
   * without being treated as theft. Covers concurrent refreshes from the frontend
   * (parallel requests / multiple Next.js instances). 0 disables the grace window.
   */
  REFRESH_REUSE_GRACE: z.coerce.number().int().min(0).default(10),

  /** Comma-separated Google OAuth client IDs accepted as ID-token audience. Empty disables Google sign-in. */
  GOOGLE_CLIENT_ID: list.default([]),

  /** Comma-separated browser origins allowed by CORS. Empty disables CORS (server-to-server only). */
  CORS_ORIGINS: list.default([]),
  /**
   * Which peers may set X-Forwarded-For (Express `trust proxy`): a hop count ("1") or a
   * comma-separated list of addresses/subnets/keywords. The default trusts private networks,
   * which is where base-frontend and load balancers live, so the real client IP reaches rate
   * limits and logs — while a client connecting directly from the internet can't spoof it.
   */
  TRUST_PROXY: z
    .string()
    .default("loopback, linklocal, uniquelocal")
    .transform((v) => (/^\d+$/.test(v.trim()) ? Number(v) : v)),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(300),
  /** Login/register/forgot-password attempts per THROTTLE_TTL per client IP + email. */
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
  /** Login/register attempts per THROTTLE_TTL per client IP, across all emails (anti credential stuffing). */
  AUTH_IP_THROTTLE_LIMIT: z.coerce.number().int().positive().default(30),
  /**
   * Failed logins per account (from any IP) within AUTH_ACCOUNT_FAILURE_WINDOW seconds before
   * the account's password login pauses. Only failures count, so the owner's successful
   * logins never contribute; a password reset clears it. Stops slow distributed guessing.
   */
  AUTH_ACCOUNT_FAILURE_LIMIT: z.coerce.number().int().positive().default(100),
  AUTH_ACCOUNT_FAILURE_WINDOW: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  SWAGGER_ENABLED: bool.optional(),
});

export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  if (EXAMPLE_SECRETS.includes(env.JWT_SECRET) || /change-?me/i.test(env.JWT_SECRET)) {
    ctx.addIssue({
      code: "custom",
      path: ["JWT_SECRET"],
      message: "is an example value; generate one with `openssl rand -base64 48`",
    });
  }
  const dbPassword = databasePassword(env.DATABASE_URL);
  if (dbPassword !== undefined && WEAK_DB_PASSWORDS.includes(dbPassword.toLowerCase())) {
    ctx.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "uses a default/weak database password; set a strong POSTGRES_PASSWORD",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
