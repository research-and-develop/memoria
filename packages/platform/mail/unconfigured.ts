import type { Mailer } from '../ports';

import { MailError } from './error';

/**
 * The mailer when email is not set up (no mail settings, or unreadable ones). Every send rejects
 * with `code` (default MAIL_NOT_CONFIGURED), transient: queued email waits and recovers once the
 * settings are fixed. `detail` says what is missing (no values).
 */
export function unconfiguredMailer(detail: string, code = 'MAIL_NOT_CONFIGURED'): Mailer {
  return {
    async send() {
      throw new MailError(code, { configuration: true, detail });
    },
  };
}
