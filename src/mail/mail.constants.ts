export const MAIL_QUEUE = "mail";

interface Recipient {
  email: string;
  name: string | null;
}

/** Job name → payload for the mail queue. */
export interface MailJobs {
  /** After sign-up. `verifyUrl` is set when the email still needs verifying. */
  welcome: Recipient & { verifyUrl?: string };
  "verify-email": Recipient & { url: string };
  "password-reset": Recipient & { url: string };
}

export type MailJobName = keyof MailJobs;
