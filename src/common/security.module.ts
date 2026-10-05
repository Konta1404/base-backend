import { Global, Module } from "@nestjs/common";
import { SessionRevocationService } from "./session-revocation.service.js";

@Global()
@Module({
  providers: [SessionRevocationService],
  exports: [SessionRevocationService],
})
export class SecurityModule {}
