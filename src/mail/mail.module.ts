import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { MAIL_QUEUE } from "./mail.constants.js";
import { MailProcessor } from "./mail.processor.js";
import { MailService } from "./mail.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
