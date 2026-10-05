import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { MAIL_QUEUE, type MailJobName, type MailJobs } from "./mail.constants.js";

/** Producer: request handlers enqueue mail here; MailProcessor sends it in the background. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  sendWelcome(data: MailJobs["welcome"]) {
    this.enqueue("welcome", data);
  }

  sendEmailVerification(data: MailJobs["verify-email"]) {
    this.enqueue("verify-email", data);
  }

  sendPasswordReset(data: MailJobs["password-reset"]) {
    this.enqueue("password-reset", data);
  }

  /**
   * Fire-and-forget: never blocks or fails the request. (BullMQ waits for Redis
   * indefinitely by design, so the enqueue is not awaited.)
   *
   * Mail jobs carry one-time links (password reset!), so they are deleted from Redis
   * as soon as they finish — succeeded or finally failed — instead of being kept in
   * the queue's job history. Don't relax this without removing secrets from the data.
   */
  private enqueue<N extends MailJobName>(name: N, data: MailJobs[N]): void {
    this.queue
      .add(name, data, { removeOnComplete: true, removeOnFail: true })
      .catch((err: Error) =>
        this.logger.error(`Could not enqueue "${name}" email: ${err.message}`),
      );
  }
}
