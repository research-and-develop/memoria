import type { MailTransport } from '@repo/platform/mail/transport';
import type { Config, Mailer } from '@repo/platform/ports';

/**
 * A kind of background job (plan p03 → The runner). Registered in `registry.ts`; run by the relay.
 *
 * - `version`: the payload version this code writes and reads (`v` in the stored payload). A job
 *   with a newer `v` (a rollback, a deploy between the app and the relay) is put back, not failed.
 * - `parse`: the stored payload (with `v`) → the handler's input; `{ ok: false, unknown: true }`
 *   for something this code does not know yet (a newer email template), treated like a newer `v`.
 * - `backoff`: minutes before the 2nd, 3rd, … attempt; the last value repeats.
 * - `run`: may resolve with fields to keep in the finished job's payload (the email's provider
 *   message id); the runner drops `params` either way.
 */
export type JobKind<P> = {
  kind: string;
  version: number;
  maxAttempts: number;
  priority: 0 | 1;
  backoff: readonly number[];
  parse(payload: Record<string, unknown>): ParseResult<P>;
  run(payload: P, ctx: JobContext): Promise<void | Record<string, unknown>>;
};

export type ParseResult<P> = { ok: true; value: P } | { ok: false; unknown: boolean };

/**
 * Any kind, for the registry: the runner only ever hands a kind the value its own `parse` made.
 * (`run` and `parse` are methods, so every `JobKind<P>` is assignable to this.)
 */
export type AnyJobKind = JobKind<unknown>;

export type JobContext = {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  now: Date;
  /** Aborted when the handler's time is up: stop and let the job retry. */
  signal: AbortSignal;
  /** The mailer for a transport (the relay builds it on Cloudflare sockets and fetch; tests: memory). */
  mailerFor: (transport: MailTransport) => Mailer;
  config: Config;
};

/**
 * A handler's own failure: a `code` safe to log and store, `permanent` when retrying cannot help.
 * Anything else a handler throws is treated as transient (`JOB_ERROR`).
 */
export class JobError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  readonly retryAfterSeconds: number | undefined;
  readonly detail: string | undefined;

  constructor(code: string, opts: { permanent?: boolean; retryAfterSeconds?: number; detail?: string } = {}) {
    super(code);
    this.name = 'JobError';
    this.code = code;
    this.permanent = opts.permanent ?? false;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.detail = opts.detail;
  }
}
