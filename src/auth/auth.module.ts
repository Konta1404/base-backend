import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AppConfig } from "../config/app-config.service.js";
import { MailModule } from "../mail/mail.module.js";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import { AccountService } from "./account.service.js";
import { AuthService } from "./auth.service.js";
import { GoogleVerifier } from "./google-verifier.service.js";
import { LoginAttemptsService } from "./login-attempts.service.js";
import { RefreshSuccessorStore } from "./refresh-successor.store.js";
import { TokenService } from "./token.service.js";

@Module({
  imports: [
    UsersModule,
    MailModule,
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get("JWT_SECRET"),
        signOptions: {
          algorithm: "HS256",
          expiresIn: config.get("JWT_ACCESS_TTL"),
          issuer: config.get("JWT_ISSUER"),
        },
        verifyOptions: { algorithms: ["HS256"], issuer: config.get("JWT_ISSUER") },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountService,
    TokenService,
    RefreshSuccessorStore,
    LoginAttemptsService,
    GoogleVerifier,
  ],
  exports: [TokenService],
})
export class AuthModule {}
