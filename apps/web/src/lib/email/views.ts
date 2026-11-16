import type { JobRow } from '@/lib/db/queries/jobs/types';

/**
 * An email job as Settings → Emails shows it (plan p03 → Email): the test email's live status and
 * the recent emails list. Pure, type imports only: client components import the labels.
 */
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'retrying' | 'failed';

export type EmailView = {
  id: string;
  template: string;
  templateLabel: string;
  /** The address, or the account label for `{ account: true }`. */
  to: string;
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  /** The stored reason (`CODE` or `CODE: masked detail`), shown as text. */
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** When the next try is due (retrying, queued); else null. */
  nextAttemptAt: string | null;
  canRetry: boolean;
};

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  retrying: 'Retrying',
  failed: 'Failed',
};

/** What a `last_error` code means, in a sentence for the photographer. Unknown codes: null. */
const SENTENCES: Record<string, string> = {
  MAIL_NOT_CONFIGURED: 'Email is not set up: choose how to send it in Settings → Emails.',
  MAIL_SECRET_UNREADABLE: 'The saved password or key cannot be read (the server key changed): enter it again.',
  SETTINGS_KEY_MISSING: 'The server has no SETTINGS_ENCRYPTION_KEY: the installer must set it.',
  MAIL_INVALID_ADDRESS: 'The address is not valid.',
  MAIL_INVALID_HEADER: 'The subject or a name contains characters email cannot carry.',
  MAIL_INVALID_SETTINGS: 'A mail setting is not valid: check Settings → Emails.',
  MAIL_ABORTED: 'Sending took too long and was stopped; it will be tried again.',
  SITE_URL_MISSING: 'The email links to your website, but no website address is set in Settings → Studio.',
  ACCOUNT_MISSING: 'There is no sign-in account to send it to.',
  SMTP_TIMEOUT: 'The mail server did not answer in time.',
  SMTP_CONNECTION: 'The mail server could not be reached.',
  SMTP_TLS: 'A secure connection to the mail server failed (its certificate?).',
  SMTP_TLS_INJECTION: 'The mail server’s connection was tampered with; it will be tried again.',
  SMTP_STARTTLS_UNAVAILABLE: 'The mail server does not offer a secure connection on this port.',
  SMTP_AUTH_UNSUPPORTED: 'The mail server does not accept a plain password login.',
  SMTP_PROTOCOL: 'The mail server answered something unexpected.',
  SMTP_535: 'The mail server refused the username or password.',
  SMTP_534: 'The mail server wants an app password, not the account password.',
  SMTP_530: 'The mail server wants to be signed in to first.',
  UNKNOWN_KIND: 'This version of the app cannot send it.',
  LEASE_EXPIRED: 'Sending stopped half-way; it will be tried again.',
  EXPIRED: 'It waited more than 7 days: the background worker was not running.',
  JOB_INVALID: 'The email’s data was damaged.',
  JOB_TIMEOUT: 'Sending took too long; it will be tried again.',
};

/** The code part of a stored `last_error` (`SMTP_550: …` → `SMTP_550`). */
export const errorCode = (lastError: string | null): string | null => (lastError ? (lastError.split(':')[0] ?? null) : null);

export function errorSentence(lastError: string | null): string | null {
  const code = errorCode(lastError);
  if (!code) return null;
  if (SENTENCES[code]) return SENTENCES[code];
  if (/^SMTP_5\d\d$/.test(code)) return 'The mail server refused the email.';
  if (/^SMTP_4\d\d$/.test(code)) return 'The mail server asked to try again later.';
  if (/^(BREVO|SES|GRAPH)(_TOKEN)?_/.test(code)) return 'The email provider refused the request: see the reason.';
  return null;
}

export function toEmailView(job: JobRow, opts: { templateLabel: string; accountLabel: string }): EmailView {
  const template = typeof job.payload.template === 'string' ? job.payload.template : '';
  const to = job.payload.to as { email?: unknown; account?: unknown } | undefined;
  const status: EmailStatus =
    job.status === 'done' ? 'sent' : job.status === 'failed' ? 'failed' : job.status === 'running' ? 'sending' : job.attempts === 0 ? 'queued' : 'retrying';
  return {
    id: job.id,
    template,
    templateLabel: opts.templateLabel,
    to: to?.account === true ? opts.accountLabel : typeof to?.email === 'string' ? to.email : '',
    status,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    lastError: job.last_error,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    nextAttemptAt: job.status === 'pending' ? job.run_after : null,
    canRetry: job.status === 'failed',
  };
}
