import type { Mailer } from '../ports';

import { brevoMailer, type BrevoSettings } from './brevo';
import type { FetchLike } from './http';
import { microsoft365Mailer, type Microsoft365Settings } from './microsoft365';
import { sesMailer, type SesSettings } from './ses';
import { smtpMailer, type SmtpConnect, type SmtpSettings } from './smtp';

/**
 * How a message leaves (plan p03, D3.16): the chosen provider with its secrets in the clear,
 * decrypted just before sending. Built from the studio's mail settings or the env fallback
 * (apps/web lib/settings/mail.ts); turned into a Mailer here.
 */
export type MailTransport =
  | { provider: 'smtp'; smtp: SmtpSettings }
  | { provider: 'brevo'; brevo: BrevoSettings }
  | { provider: 'ses'; ses: SesSettings }
  | { provider: 'microsoft365'; microsoft365: Microsoft365Settings };

export type MailProvider = MailTransport['provider'];

/** What the platform gives the adapters: SMTP sockets, `fetch`, and work after the send (SMTP's QUIT). */
export type TransportDeps = { smtpConnect: SmtpConnect; fetch: FetchLike; background: (task: Promise<unknown>) => void };

export function mailerForTransport(transport: MailTransport, deps: TransportDeps): Mailer {
  switch (transport.provider) {
    case 'smtp':
      return smtpMailer(transport.smtp, deps.smtpConnect, { background: deps.background });
    case 'brevo':
      return brevoMailer(transport.brevo, deps.fetch);
    case 'ses':
      return sesMailer(transport.ses, deps.fetch);
    case 'microsoft365':
      return microsoft365Mailer(transport.microsoft365, deps.fetch);
  }
}
