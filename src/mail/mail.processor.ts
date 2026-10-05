import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { AppConfig } from "../config/app-config.service.js";
import { MAIL_QUEUE, type MailJobs } from "./mail.constants.js";

const hi = (name: string | null) => `Hi ${name ?? "there"},`;

interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Consumer for the mail queue, running in the API process. Failed jobs are
 * retried (see QueueModule defaults). Plug a real provider (SES, Resend,
 * Postmark…) into `deliver`.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly config: AppConfig) {
    super();
  }

  async process(job: Job): Promise<void> {
    await this.deliver(this.render(job));
  }

  /** Final failures are deleted with their data (see MailService), so log enough to investigate. */
  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error) {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error(`Mail job "${job.name}" ${final ? "gave up" : "failed, will retry"}`, {
      jobId: job.id,
      attempt: job.attemptsMade,
      error: error.message,
    });
  }

  private render(job: Job): Email {
    switch (job.name) {
      case "welcome": {
        const d = job.data as MailJobs["welcome"];
        const verify = d.verifyUrl ? `\n\nPlease confirm your email: ${d.verifyUrl}` : "";
        return {
          to: d.email,
          subject: "Welcome!",
          text: `${hi(d.name)} thanks for signing up.${verify}`,
        };
      }
      case "verify-email": {
        const d = job.data as MailJobs["verify-email"];
        return {
          to: d.email,
          subject: "Confirm your email",
          text: `${hi(d.name)} confirm your email: ${d.url}`,
        };
      }
      case "password-reset": {
        const d = job.data as MailJobs["password-reset"];
        return {
          to: d.email,
          subject: "Reset your password",
          text: `${hi(d.name)} reset your password: ${d.url}\n\nIf you didn't ask for this, ignore this email.`,
        };
      }
      default:
        throw new Error(`Unknown mail job: ${job.name}`);
    }
  }

  private async deliver(email: Email) {
    // Stub: replace with your email provider.
    this.logger.log(`[stub] would send "${email.subject}" to ${email.to}`);
    // Bodies contain one-time links (password reset!). Print them only in
    // development so you can click through the flows — never in production,
    // whatever the log level.
    if (!this.config.isProduction) this.logger.log(`[stub] email body:\n${email.text}`);
  }
}
