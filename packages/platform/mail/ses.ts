import { AwsV4Signer } from 'aws4fetch';

import type { Mailer } from '../ports';

import { MailError } from './error';
import { jsonBody, mailFetch, retryAfterSeconds, stringField, type FetchLike } from './http';
import { maskAddresses } from './mask';
import { base64, buildMessage, checkMessage } from './mime';
import { isSesRegion, type SesRegion } from './sesRegions';

/**
 * Amazon SES v2 `SendEmail` with raw MIME (plan p03 → HTTPS adapters), signed with SigV4
 * (`aws4fetch`, service `ses`). SES replaces our Message-ID with its own; its `MessageId` is the
 * delivery reference (D3.20).
 *
 * Classified by the error type (`x-amzn-ErrorType`, else the body's `__type`/`code`):
 * - permanent: `MessageRejected` (also an unverified sender: fix it, then Retry), `BadRequestException`,
 *   `NotFoundException`, any other 4xx;
 * - configuration (retried, `mail_auth_failed`): an unverified MAIL FROM domain, a suspended or paused
 *   account, wrong or unauthorised credentials, any 403;
 * - transient: throttling and limits, 429, 5xx, network, timeout.
 */
export type SesSettings = { region: SesRegion; accessKeyId: string; secretAccessKey: string };

export const sesUrl = (region: SesRegion) => `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

const PERMANENT = new Set(['MessageRejected', 'BadRequestException', 'NotFoundException']);
const CONFIGURATION = new Set([
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
  'UnrecognizedClientException',
  'SignatureDoesNotMatch',
  'InvalidSignatureException',
  'IncompleteSignatureException',
  'InvalidClientTokenId',
  'AccessDeniedException',
]);
const TRANSIENT = new Set(['TooManyRequestsException', 'LimitExceededException', 'ThrottlingException']);

/** `MessageRejected:http://internal.amazon.com/…` or `com.amazonaws.ses#MessageRejected` → `MessageRejected`. */
export function sesErrorType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.split(':')[0]!.split('#').pop()!.replace(/[^A-Za-z0-9]/g, '');
  return name || undefined;
}

/** SigV4's `x-amz-date` form: `20261116T185608Z`. */
const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

export function sesMailer(settings: SesSettings, fetchFn: FetchLike, opts: { now?: () => Date } = {}): Mailer {
  const now = opts.now ?? (() => new Date());
  return {
    async send(message, { signal }) {
      const { from, to } = checkMessage(message);
      if (!isSesRegion(settings.region)) throw new MailError('MAIL_INVALID_SETTINGS', { permanent: true, configuration: true, detail: 'region' });
      if (signal.aborted) throw new MailError('MAIL_ABORTED');
      const date = now();
      const mime = buildMessage(message, { date });
      const url = sesUrl(settings.region);
      const body = JSON.stringify({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Raw: { Data: base64(new TextEncoder().encode(mime)) } },
      });
      const signed = await new AwsV4Signer({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body,
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
        service: 'ses',
        region: settings.region,
        datetime: amzDate(date),
      }).sign();
      const response = await mailFetch(fetchFn, url, { method: 'POST', headers: signed.headers, body }, { signal, prefix: 'SES' });
      const json = await jsonBody(response);
      if (response.ok) return { providerMessageId: stringField(json, 'MessageId') ?? null };

      const type = sesErrorType(response.headers.get('x-amzn-errortype') ?? stringField(json, '__type') ?? stringField(json, 'code') ?? stringField(json, 'Code'));
      const text = stringField(json, 'message') ?? stringField(json, 'Message');
      const detail = text ? maskAddresses(text, { also: [to, from, settings.accessKeyId, settings.secretAccessKey] }) : undefined;
      const code = `SES_${type ?? response.status}`;
      const status = response.status;
      if (type && TRANSIENT.has(type)) throw new MailError(code, { retryAfterSeconds: retryAfterSeconds(response), detail });
      if ((type && CONFIGURATION.has(type)) || status === 401 || status === 403) throw new MailError(code, { configuration: true, detail });
      if (type && PERMANENT.has(type)) throw new MailError(code, { permanent: true, detail });
      if (status === 429 || status >= 500) throw new MailError(code, { retryAfterSeconds: retryAfterSeconds(response), detail });
      if (status >= 400) throw new MailError(code, { permanent: true, detail });
      throw new MailError(code, { detail });
    },
  };
}
