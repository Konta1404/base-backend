import { ConsoleLogger, type LogLevel } from "@nestjs/common";

const LEVELS: LogLevel[] = ["fatal", "error", "warn", "log", "debug", "verbose"];

/**
 * App-wide logger. Created before config validation (it has to log that), so it
 * reads LOG_FORMAT / LOG_LEVEL straight from the environment; env.ts validates
 * them afterwards.
 *
 * json   → one JSON object per line (production default): ship to Loki, Datadog, CloudWatch…
 * pretty → colored, human-readable (development default).
 */
export function createLogger() {
  const format =
    process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");
  const level = (process.env.LOG_LEVEL ?? "log") as LogLevel;
  const logLevels = LEVELS.slice(0, Math.max(LEVELS.indexOf(level), 1) + 1);

  return new ConsoleLogger({
    json: format === "json",
    logLevels,
    // Structured metadata: logger.log("message", { key: value })
    structuredParams: true,
    flattenParams: true,
    redact: ["password", "passwordHash", "token", "accessToken", "refreshToken", "idToken"],
  });
}
