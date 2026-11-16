import { firstRow, run, statement, type Options, type SqlValue, type Statement } from '@repo/db/client';

import { toClaimedJob, type ClaimedJob, type ClaimedJobDbRow, type JobFence, type JobInput } from './types';

/**
 * The writes of the job queue (plan p03 → Writes that must not race). Each one is a single
 * statement whose WHERE carries its own guarantee; none reads first. Every timestamp is
 * `Date#toISOString()` (the CHECK holds them to that shape), so comparing text compares time.
 */

const INSERT_COLUMNS = 'id, kind, payload, priority, max_attempts, run_after, ref, dedupe_key, created_at, updated_at';
const insertValues = (input: JobInput) => [
  input.id,
  input.kind,
  input.payload,
  input.priority,
  input.maxAttempts,
  input.runAfter,
  input.ref ?? null,
  input.dedupeKey ?? null,
  input.now,
  input.now,
];

/**
 * Enqueue, in the caller's batch. With a `dedupeKey`: once while a row with that key exists (a
 * repeat changes nothing). Keys are for system jobs only, never for a send a person asked for.
 */
export function enqueueJobStatement(input: JobInput): Statement {
  return statement(`INSERT INTO jobs (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`, insertValues(input));
}

/**
 * Enqueue only when `condition` holds, in the caller's batch: a security notice exists only if its
 * event happened (plan p03, D3.19). `condition` is SQL for a WHERE (`changes() > 0` right after the
 * statement it is about, or an `EXISTS (…)`); its `?` take `params`. No dedupe key.
 */
export function conditionalEnqueueJobStatement(input: JobInput, condition: string, params: readonly SqlValue[]): Statement {
  return statement(`INSERT INTO jobs (${INSERT_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condition}`, [...insertValues(input), ...params]);
}

/**
 * The admin's Retry on a failed email (Settings → Emails): back to pending with its attempts reset.
 * Only a failed email: a running, pending or sent one is left alone (changes 0).
 */
export function retryFailedEmailStatement(input: { id: string; now: string }): Statement {
  return statement(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_after = ?, finished_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND kind = 'email' AND status = 'failed'`,
    [input.now, input.now, input.id],
  );
}

/**
 * Schedule, or move while still pending (Phase 10 reminders): a pending job with the key takes the
 * new time and payload; a running or finished one is left alone.
 */
export function upsertScheduledJobStatement(input: JobInput & { dedupeKey: string }): Statement {
  return statement(
    `INSERT INTO jobs (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (dedupe_key) DO UPDATE SET run_after = excluded.run_after, payload = excluded.payload, updated_at = excluded.updated_at
  WHERE jobs.status = 'pending'`,
    insertValues(input),
  );
}

/**
 * A periodic job (each cron): inserted only when no job holds the key, so an ordinary tick
 * writes nothing.
 */
export function periodicJobStatement(input: JobInput & { dedupeKey: string }): Statement {
  return statement(
    `INSERT INTO jobs (${INSERT_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = ?)`,
    [...insertValues(input), input.dedupeKey],
  );
}

/**
 * Cancel the pending jobs about `ref` (and of `kind`): a running one finishes; the key is freed
 * for a new schedule.
 */
export function cancelPendingJobsStatement(input: { ref: string; kind?: string; now: string }): Statement {
  const kind = input.kind ? ' AND kind = ?' : '';
  return statement(
    `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'CANCELLED', dedupe_key = NULL, updated_at = ?
  WHERE ref = ? AND status = 'pending'${kind}`,
    [input.now, input.now, input.ref, ...(input.kind ? [input.kind] : [])],
  );
}

/**
 * A dead runner's job (its lease ran out): back to pending 10 minutes later (`retryAt`), or failed
 * when it has no attempt left. `LEASE_EXPIRED` is its trace.
 */
export function expireLeasesStatement(input: { now: string; retryAt: string }): Statement {
  return statement(
    `UPDATE jobs SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
    finished_at = CASE WHEN attempts >= max_attempts THEN ? ELSE NULL END,
    run_after = ?, last_error = 'LEASE_EXPIRED', updated_at = ?
  WHERE status = 'running' AND run_after <= ?`,
    [input.now, input.retryAt, input.now, input.now],
  );
}

export async function expireLeases(input: { now: string; retryAt: string }, opts?: Options): Promise<number> {
  return (await run(expireLeasesStatement(input), opts)).changes;
}

/**
 * Claim the next due job: priority first, then the earliest. One statement, so two runners never
 * hold the same job (the inner SELECT and the outer WHERE agree). The attempt is counted here,
 * so a job that kills its invocation every time still ends; a row at `max_attempts` is never
 * selected (it would break ck_jobs_attempts and jam the queue).
 */
export function claimDueJobStatement(input: { now: string; leaseUntil: string }): Statement {
  const due = `status = 'pending' AND run_after <= ? AND attempts < max_attempts`;
  return statement(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, run_after = ?, updated_at = ?
  WHERE id = (SELECT id FROM jobs WHERE ${due} ORDER BY priority, run_after LIMIT 1) AND ${due}
  RETURNING id, kind, payload, attempts, max_attempts, last_error, created_at`,
    [input.leaseUntil, input.now, input.now, input.now],
  );
}

export function claimDueJob(input: { now: string; leaseUntil: string }, opts?: Options): Promise<ClaimedJob | null> {
  return firstRow<ClaimedJobDbRow, ClaimedJob>(claimDueJobStatement(input), toClaimedJob, opts);
}

const FENCE = `WHERE id = ? AND status = 'running' AND attempts = ?`;
const fence = (f: JobFence) => [f.id, f.attempts];

/** Done. `payload` (JSON text) replaces the stored one, e.g. without its `params`; null keeps it. */
export async function completeJob(input: JobFence & { now: string; payload: string | null }, opts?: Options): Promise<boolean> {
  const result = await run(
    statement(`UPDATE jobs SET status = 'done', finished_at = ?, updated_at = ?, last_error = NULL, payload = COALESCE(?, payload) ${FENCE}`, [
      input.now,
      input.now,
      input.payload,
      ...fence(input),
    ]),
    opts,
  );
  return result.changes > 0;
}

/** Retry later: pending again at `runAfter`, with why it failed. */
export async function rescheduleJob(input: JobFence & { now: string; runAfter: string; lastError: string }, opts?: Options): Promise<boolean> {
  const result = await run(
    statement(`UPDATE jobs SET status = 'pending', run_after = ?, last_error = ?, updated_at = ? ${FENCE}`, [input.runAfter, input.lastError, input.now, ...fence(input)]),
    opts,
  );
  return result.changes > 0;
}

/** Failed for good. `payload` as for `completeJob`. */
export async function failJob(input: JobFence & { now: string; lastError: string; payload: string | null }, opts?: Options): Promise<boolean> {
  const result = await run(
    statement(`UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ?, payload = COALESCE(?, payload), updated_at = ? ${FENCE}`, [
      input.now,
      input.lastError,
      input.payload,
      input.now,
      ...fence(input),
    ]),
    opts,
  );
  return result.changes > 0;
}

/**
 * Not this code's job (an unknown kind, or a newer payload version: version skew during a deploy
 * or after a rollback): pending again at `runAfter` and the attempt given back.
 */
export async function deferJob(input: JobFence & { now: string; runAfter: string; code: string }, opts?: Options): Promise<boolean> {
  const result = await run(
    statement(`UPDATE jobs SET status = 'pending', attempts = attempts - 1, run_after = ?, last_error = ?, updated_at = ? ${FENCE}`, [
      input.runAfter,
      input.code,
      input.now,
      ...fence(input),
    ]),
    opts,
  );
  return result.changes > 0;
}

/** Housekeeping: a pending job due since before `before` (the relay was down for a week) fails. */
export async function expireStaleJobs(input: { before: string; now: string }, opts?: Options): Promise<number> {
  const result = await run(
    statement(`UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'EXPIRED', updated_at = ? WHERE status = 'pending' AND run_after < ?`, [
      input.now,
      input.now,
      input.before,
    ]),
    opts,
  );
  return result.changes;
}

/** Housekeeping: delete up to `limit` jobs finished before `before`, oldest first. */
export async function pruneFinishedJobs(input: { before: string; limit: number }, opts?: Options): Promise<number> {
  const result = await run(
    statement('DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE finished_at < ? ORDER BY finished_at LIMIT ?)', [input.before, input.limit]),
    opts,
  );
  return result.changes;
}
