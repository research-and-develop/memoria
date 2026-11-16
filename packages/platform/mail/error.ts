/**
 * Why a message was not sent (plan p03, D3.9, D3.11). Every mail adapter rejects with one.
 *
 * - `code`: an enumerated string, safe to log and to store (`SMTP_550`, `BREVO_401`,
 *   `MAIL_NOT_CONFIGURED`, …). Never the server's text.
 * - `permanent`: retrying cannot help (a rejected recipient). Otherwise the job retries with backoff.
 * - `configuration`: credentials or permissions are wrong. Retried (a fixed password recovers the
 *   queue), and logged as an error so someone looks.
 * - `retryAfterSeconds`: the provider's `Retry-After`, when it gave one.
 * - `detail`: the provider's text with every address masked, ≤ 500 characters: shown to the admin
 *   (jobs.last_error), never logged.
 */
export class MailError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  readonly configuration: boolean;
  readonly retryAfterSeconds: number | undefined;
  readonly detail: string | undefined;

  constructor(code: string, opts: { permanent?: boolean; configuration?: boolean; retryAfterSeconds?: number; detail?: string } = {}) {
    super(code);
    this.name = 'MailError';
    this.code = code;
    this.permanent = opts.permanent ?? false;
    this.configuration = opts.configuration ?? false;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.detail = opts.detail;
  }
}
