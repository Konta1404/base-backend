import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfig } from "./app-config.service.js";
import { validateEnv } from "./env.js";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ cache: true, validate: validateEnv })],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
