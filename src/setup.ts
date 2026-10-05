import { type INestApplication, ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppConfig } from "./config/app-config.service.js";
import { MetricsService } from "./observability/metrics.service.js";
import { requestContext } from "./observability/request-context.js";

/** Shared by main.ts and the e2e tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication) {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;

  express.set("trust proxy", config.get("TRUST_PROXY"));
  express.disable("x-powered-by");
  app.use(requestContext(app.get(MetricsService), config));
  app.use(helmet());

  const origins = config.get("CORS_ORIGINS");
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("base-backend")
        .setDescription("API for base-frontend")
        .setVersion("1.0")
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("docs", app, document);
  }

  return config;
}
