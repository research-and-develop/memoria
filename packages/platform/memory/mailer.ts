import { MailError } from '../mail/error';
import { checkMessage } from '../mail/mime';
import type { MailMessage, Mailer } from '../ports';

/**
 * A mailer that keeps what it is given (tests). It checks every message like a real adapter
 * (`checkMessage`). `failWith(error)` makes the next sends reject, once each, in order.
 */
export type MemoryMailer = Mailer & {
  readonly sent: readonly MailMessage[];
  failWith(...errors: MailError[]): void;
};

export function memoryMailer(): MemoryMailer {
  const sent: MailMessage[] = [];
  const failures: MailError[] = [];
  return {
    sent,
    failWith(...errors) {
      failures.push(...errors);
    },
    async send(message, { signal }) {
      if (signal.aborted) throw new MailError('MAIL_ABORTED');
      checkMessage(message);
      const failure = failures.shift();
      if (failure) throw failure;
      sent.push(message);
      return { providerMessageId: `memory-${sent.length}` };
    },
  };
}
