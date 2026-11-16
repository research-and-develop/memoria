import type { SqlValue, Statement } from '@repo/db/client';
import { getPlatform } from '@repo/platform/current';

import { conditionalEnqueueJobStatement, enqueueJobStatement } from '@/lib/db/queries/jobs';

import type { JobKind } from './types';

/** A payload's JSON may not exceed this (the column allows 16 KB; the rest is headroom for retries' data). */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

/**
 * A job as a statement for the caller's batch (plan p03, D3.1): the change, its audit row and its
 * job are written together or not at all. Then, after the batch, `nudgeRelay()`.
 *
 *   const job = jobStatement(emailJob, { … }, { now });
 *   await batch([...change, auditStatement(…), job.statement]);
 *   nudgeRelay();
 *
 * Pure: it checks the payload with the kind's own `parse` (after adding `v`) and its size, and
 * throws on a bad one (a programming error, never user input). `maxAttempts` overrides the kind's
 * (the test email gets one attempt).
 */
export function jobStatement<P extends Record<string, unknown>>(
  kind: JobKind<unknown>,
  payload: P,
  opts: { now: Date; runAfter?: Date; ref?: string; dedupeKey?: string; id?: string; maxAttempts?: number; when?: JobCondition },
): { id: string; statement: Statement } {
  const stored = { ...payload, v: kind.version };
  if (!kind.parse(stored).ok) throw new Error(`jobStatement: the ${kind.kind} payload does not parse`);
  const json = JSON.stringify(stored);
  if (new TextEncoder().encode(json).length > MAX_PAYLOAD_BYTES) throw new Error(`jobStatement: the ${kind.kind} payload is over ${MAX_PAYLOAD_BYTES} bytes`);
  const id = opts.id ?? crypto.randomUUID();
  const now = opts.now.toISOString();
  const input = {
    id,
    kind: kind.kind,
    payload: json,
    priority: kind.priority,
    maxAttempts: opts.maxAttempts ?? kind.maxAttempts,
    runAfter: (opts.runAfter ?? opts.now).toISOString(),
    ref: opts.ref ?? null,
    dedupeKey: opts.dedupeKey ?? null,
    now,
  };
  if (opts.when && opts.dedupeKey) throw new Error('jobStatement: a conditional job takes no dedupe key');
  return { id, statement: opts.when ? conditionalEnqueueJobStatement(input, opts.when.sql, opts.when.params) : enqueueJobStatement(input) };
}

/**
 * Write the job only if this holds when its statement runs (a WHERE, `?` bound to `params`): a
 * security notice exists only if its event happened (plan p03, D3.19).
 */
export type JobCondition = { sql: string; params: readonly SqlValue[] };

/**
 * Wake the relay after a batch that wrote a job: it runs within seconds. A hint, after the
 * response (`defer`): a lost nudge is picked up by the relay's cron within a minute.
 */
export function nudgeRelay(): void {
  const platform = getPlatform();
  platform.defer(platform.jobs().nudge());
}
