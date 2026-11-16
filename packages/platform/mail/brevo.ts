import type { MailAddress, Mailer } from '../ports';

import { MailError } from './error';
import { jsonBody, mailFetch, retryAfterSeconds, stringField, type FetchLike } from './http';
import { maskAddresses } from './mask';
import { checkMessage } from './mime';

/**
 * Brevo's transactional email API (plan p03 → HTTPS adapters). One `POST /v3/smtp/email` per
 * message, JSON (Brevo takes no raw MIME, and sets its own Message-ID). The job id goes in as
 * `idempotencyKey`, so a retry after a lost answer is not sent twice: Brevo's `duplicate_request`
 * counts as sent (D3.20).
 *
 * | Answer | Outcome |
 * | --- | --- |
 * | 201/202 | sent, `messageId` |
 * | 400 `duplicate_request` | sent (already) |
 * | 401, 402, 403 | configuration (key, credits, IP allow-listing): retried, `mail_auth_failed` |
 * | 429, 5xx, network, timeout | transient (`Retry-After` honoured) |
 * | any other 4xx (400, 404, …) | permanent |
 */
export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export type BrevoSettings = { apiKey: string };

const party = (address: MailAddress) => (address.name ? { email: address.email, name: address.name } : { email: address.email });

export function brevoMailer(settings: BrevoSettings, fetchFn: FetchLike): Mailer {
  return {
    async send(message, { signal }) {
      checkMessage(message);
      const body = {
        sender: party(message.from),
        to: [party(message.to)],
        ...(message.replyTo ? { replyTo: party(message.replyTo) } : {}),
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
        headers: { idempotencyKey: message.id, 'Auto-Submitted': 'auto-generated' },
      };
      const response = await mailFetch(
        fetchFn,
        BREVO_URL,
        {
          method: 'POST',
          headers: { 'api-key': settings.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        },
        { signal, prefix: 'BREVO' },
      );
      const json = await jsonBody(response);
      if (response.status === 201 || response.status === 202) return { providerMessageId: stringField(json, 'messageId') ?? null };

      const errorCode = stringField(json, 'code');
      if (response.status === 400 && errorCode === 'duplicate_request') return { providerMessageId: stringField(json, 'messageId') ?? null };

      const text = [errorCode, stringField(json, 'message')].filter(Boolean).join(': ');
      const detail = text ? maskAddresses(text, { also: [message.to.email, settings.apiKey] }) : undefined;
      const code = `BREVO_${response.status}`;
      const status = response.status;
      if (status === 401 || status === 402 || status === 403) throw new MailError(code, { configuration: true, detail });
      if (status === 429 || status >= 500) throw new MailError(code, { retryAfterSeconds: retryAfterSeconds(response), detail });
      if (status >= 400) throw new MailError(code, { permanent: true, detail });
      // A 2xx/3xx we do not expect: not known to be sent, so try again later.
      throw new MailError(code, { detail });
    },
  };
}
