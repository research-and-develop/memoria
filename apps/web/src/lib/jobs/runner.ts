import type { Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';
import type { MailTransport } from '@repo/platform/mail/transport';
import type { Mailer } from '@repo/platform/ports';

import { claimDueJob, completeJob, deferJob, expireLeases, failJob, rescheduleJob, type ClaimedJob } from '@/lib/db/queries/jobs';

import { nextRunAfter } from './backoff';
import { JOB_KINDS } from './registry';
import { JobError, type AnyJobKind } from './types';

export type DrainTrigger = 'nudge' | 'cron';

/**
 * How much one drain may do (plan p03 → The runner). One job per invocation: the free plan's
 * 10 ms of CPU covers the whole invocation, `waitUntil` work included. The cron goes to more only
 * if the production measurement (Verification 4) shows room. The budget counts from the drain's
 * start; no job starts with less than MIN_REMAINING_MS left.
 */
export const DRAIN_LIMITS: Record<DrainTrigger, { jobs: number; budgetMs: number }> = {
  nudge: { jobs: 1, budgetMs: 25_000 },
  cron: { jobs: 1, budgetMs: 60_000 },
};
export const HANDLER_CAP_MS = 20_000;
export const MIN_REMAINING_MS = 20_000;
/** A claimed job is its runner's for this long; after it, the next drain hands it back (+10 min). */
export const LEASE_MS = 2 * 60_000;
/** A dead runner's job, or one this code does not know yet, waits this long before its next try. */
export const RETRY_LATER_MS = 10 * 60_000;
/** A job of an unknown kind or newer version fails UNKNOWN_KIND once it is this old. */
export const UNKNOWN_KIND_AFTER_MS = 24 * 60 * 60_000;

export type DrainSummary = { claimed: number; done: number; retried: number; failed: number; deferred: number; leaseLost: number; leasesExpired: number };

type RunInput = {
  /** The mailer for a transport (the relay: Cloudflare sockets and fetch). */
  mailerFor: (transport: MailTransport) => Mailer;
  trigger: DrainTrigger;
  /** Claims, leases and backoff (default: the real clock). */
  clock?: () => Date;
  /** Default JOB_KINDS; tests register test-only kinds. */
  registry?: readonly AnyJobKind[];
  /** Default HANDLER_CAP_MS; tests shorten it. */
  handlerCapMs?: number;
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * One drain of the queue: hand back expired leases, then claim and run due jobs within the
 * trigger's limits. Never throws (a failure is logged as `relay_drain_failed`): the relay must
 * answer and the next tick tries again. Logs one `relay_drain` line when anything happened, never
 * a payload, an address or a parameter.
 */
export async function runDueJobs(input: RunInput, opts?: Options): Promise<DrainSummary> {
  const clock = input.clock ?? (() => new Date());
  const registry = input.registry ?? JOB_KINDS;
  const limits = DRAIN_LIMITS[input.trigger];
  const start = clock().getTime();
  const summary: DrainSummary = { claimed: 0, done: 0, retried: 0, failed: 0, deferred: 0, leaseLost: 0, leasesExpired: 0 };
  try {
    summary.leasesExpired = await expireLeases({ now: iso(start), retryAt: iso(start + RETRY_LATER_MS) }, opts);
    while (summary.claimed < limits.jobs) {
      const remaining = limits.budgetMs - (clock().getTime() - start);
      if (remaining < MIN_REMAINING_MS) break;
      const now = clock().getTime();
      const job = await claimDueJob({ now: iso(now), leaseUntil: iso(now + LEASE_MS) }, opts);
      if (!job) break;
      summary.claimed += 1;
      const outcome = await runOne(job, { registry, clock, mailerFor: input.mailerFor, capMs: Math.min(input.handlerCapMs ?? HANDLER_CAP_MS, remaining) }, opts);
      summary[outcome] += 1;
    }
  } catch (error) {
    logger.error({ event: 'relay_drain_failed', trigger: input.trigger, message: error instanceof Error ? error.message : String(error) });
  }
  if (summary.claimed || summary.leasesExpired) logger.info({ event: 'relay_drain', trigger: input.trigger, ...summary, ms: clock().getTime() - start });
  return summary;
}

type Outcome = 'done' | 'retried' | 'failed' | 'deferred' | 'leaseLost';

async function runOne(
  job: ClaimedJob,
  run: { registry: readonly AnyJobKind[]; clock: () => Date; mailerFor: RunInput['mailerFor']; capMs: number },
  opts?: Options,
): Promise<Outcome> {
  const log = { jobId: job.id, kind: job.kind, attempt: job.attempts };
  const fence = { id: job.id, attempts: job.attempts };
  const kind = run.registry.find((k) => k.kind === job.kind);
  const version = typeof job.payload.v === 'number' ? job.payload.v : 0;
  const parsed = kind && version <= kind.version ? kind.parse(job.payload) : null;

  // Not this code's job (yet): a newer version during a deploy or after a rollback. The attempt
  // is given back; after a day it is not coming, and the job fails.
  if (!kind || !parsed || (!parsed.ok && parsed.unknown)) {
    const now = run.clock().getTime();
    if (now - Date.parse(job.created_at) > UNKNOWN_KIND_AFTER_MS) {
      return finishFailed(job, 'UNKNOWN_KIND', run.clock, log, opts);
    }
    const deferred = await deferJob({ ...fence, now: iso(now), runAfter: iso(now + RETRY_LATER_MS), code: 'UNKNOWN_KIND' }, opts);
    logger.warn({ event: deferred ? 'job_deferred' : 'job_lease_lost', ...log, code: 'UNKNOWN_KIND' });
    return deferred ? 'deferred' : 'leaseLost';
  }
  if (!parsed.ok) return finishFailed(job, 'JOB_INVALID', run.clock, log, opts);
  if (job.last_error === 'LEASE_EXPIRED') logger.warn({ event: 'job_reclaimed', ...log });

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new JobError('JOB_TIMEOUT'));
    }, run.capMs);
  });
  const ctx = {
    jobId: job.id,
    attempt: job.attempts,
    maxAttempts: job.max_attempts,
    now: run.clock(),
    signal: controller.signal,
    mailerFor: run.mailerFor,
    config: getPlatform().config(),
  };
  let failure: unknown = null;
  let result: void | Record<string, unknown> = undefined;
  try {
    const handler = kind.run(parsed.value, ctx);
    handler.catch(() => {}); // a late rejection after the time is up is ignored, not unhandled
    result = await Promise.race([handler, timeUp]);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
  }

  if (failure === null) {
    const ok = await completeJob({ ...fence, now: run.clock().toISOString(), payload: finishedPayload(job.payload, result ?? undefined) }, opts);
    if (!ok) {
      logger.warn({ event: 'job_lease_lost', ...log });
      return 'leaseLost';
    }
    logger.info({ event: 'job_done', ...log });
    return 'done';
  }

  const error = errorInfo(failure);
  const lastError = (error.detail ? `${error.code}: ${error.detail}` : error.code).slice(0, 500);
  if (error.permanent || job.attempts >= job.max_attempts) {
    return finishFailed(job, lastError, run.clock, { ...log, code: error.code, configuration: error.configuration }, opts);
  }
  const now = run.clock();
  const ok = await rescheduleJob({ ...fence, now: now.toISOString(), runAfter: nextRunAfter(job.attempts, now, kind.backoff, error.retryAfterSeconds).toISOString(), lastError }, opts);
  if (!ok) {
    logger.warn({ event: 'job_lease_lost', ...log });
    return 'leaseLost';
  }
  (error.configuration ? logger.error : logger.warn)({ event: 'job_retry', ...log, code: error.code });
  return 'retried';
}

async function finishFailed(
  job: ClaimedJob,
  lastError: string,
  clock: () => Date,
  log: Record<string, unknown>,
  opts?: Options,
): Promise<Outcome> {
  // A failed job keeps its payload: the admin may Retry it (Settings → Emails); housekeeping deletes
  // it after 30 days.
  const ok = await failJob({ id: job.id, attempts: job.attempts, now: clock().toISOString(), lastError, payload: null }, opts);
  if (!ok) {
    logger.warn({ event: 'job_lease_lost', ...log });
    return 'leaseLost';
  }
  logger.warn({ event: 'job_failed', code: lastError.split(':')[0], ...log });
  return 'failed';
}

/**
 * Payload fields dropped when a job is done: `params` may name people (plan p03, D3.11); `via` is a
 * snapshot of the previous mail settings, secrets sealed (D3.18). A FAILED job keeps them, so a
 * Retry can send it; it is deleted 30 days after it ended (housekeeping).
 */
export const PRIVATE_PAYLOAD_FIELDS = ['params', 'via'] as const;

/** The payload of a finished job: the private fields dropped, the handler's result kept (D3.20); null = unchanged. */
function finishedPayload(payload: Record<string, unknown>, result?: Record<string, unknown>): string | null {
  if (!PRIVATE_PAYLOAD_FIELDS.some((f) => f in payload) && !result) return null;
  const rest = Object.fromEntries(Object.entries(payload).filter(([key]) => !(PRIVATE_PAYLOAD_FIELDS as readonly string[]).includes(key)));
  return JSON.stringify({ ...rest, ...result, v: payload.v });
}

/** What the runner needs from anything a handler throws (JobError, MailError, or anything else). */
function errorInfo(error: unknown): { code: string; permanent: boolean; configuration: boolean; retryAfterSeconds?: number; detail?: string } {
  if (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string') {
    const e = error as { code: string; permanent?: unknown; configuration?: unknown; retryAfterSeconds?: unknown; detail?: unknown };
    return {
      code: e.code,
      permanent: e.permanent === true,
      configuration: e.configuration === true,
      retryAfterSeconds: typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : undefined,
      detail: typeof e.detail === 'string' ? e.detail : undefined,
    };
  }
  // Unknown errors may carry anything in their message (an address): only the name is kept.
  return { code: 'JOB_ERROR', permanent: false, configuration: false, detail: error instanceof Error ? error.name : undefined };
}
