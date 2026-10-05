import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { createLogger } from "./observability/logger.js";
import { configureApp } from "./setup.js";

const app = await NestFactory.create(AppModule, { logger: createLogger() });
const config = configureApp(app);
const port = config.get("PORT");
await app.listen(port, "0.0.0.0");

const logger = new Logger("Bootstrap");
logger.log(`API listening on http://localhost:${port}`);
if (config.swaggerEnabled) logger.log(`Swagger UI at http://localhost:${port}/docs`);
if (config.isProduction && config.metricsEnabled && !config.get("METRICS_TOKEN")) {
  logger.warn(
    "/metrics is public (METRICS_ENABLED=true without METRICS_TOKEN): block it at your proxy",
  );
}
