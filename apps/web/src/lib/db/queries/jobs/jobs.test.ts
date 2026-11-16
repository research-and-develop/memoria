import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import {
  cancelPendingJobsStatement,
  claimDueJob,
  completeJob,
  deferJob,
  enqueueJobStatement,
  expireLeases,
  expireStaleJobs,
  failJob,
  getJob,
  periodicJobStatement,
  pruneFinishedJobs,
  rescheduleJob,
  upsertScheduledJobStatement,
  type JobInput,
} from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const T0 = Date.parse('2026-11-16T10:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
let seq = 0;
const job = (over: Partial<JobInput> = {}): JobInput => ({
  id: `job-${++seq}`,
  kind: 'test.ok',
  payload: '{"v":1}',
  priority: 0,
  maxAttempts: 3,
  runAfter: at(0),
  now: at(0),
  ...over,
});
const enqueue = async (over: Partial<JobInput> = {}) => {
  const input = job(over);
  await run(enqueueJobStatement(input), opts());
  return input.id;
};
const claim = (minutes = 0) => claimDueJob({ now: at(minutes), leaseUntil: at(minutes + 2) }, opts());
const status = async (id: string) => (await getJob(id, opts()))?.status;

describe('enqueue', () => {
  it('inserts; with a key, a repeat changes nothing; without one, every insert counts', async () => {
    expect((await run(enqueueJobStatement(job({ dedupeKey: 'k' })), opts())).changes).toBe(1);
    expect((await run(enqueueJobStatement(job({ dedupeKey: 'k' })), opts())).changes).toBe(0);
    await enqueue();
    await enqueue();
    expect(await all(statement('SELECT id FROM jobs'), opts())).toHaveLength(3);
  });

  it('a periodic insert writes nothing while the key exists', async () => {
    expect((await run(periodicJobStatement({ ...job(), dedupeKey: 'housekeeping:2026-11-16' }), opts())).changes).toBe(1);
    expect((await run(periodicJobStatement({ ...job(), dedupeKey: 'housekeeping:2026-11-16' }), opts())).changes).toBe(0);
  });

  it('a scheduled job moves while pending, not once it ran', async () => {
    await run(upsertScheduledJobStatement({ ...job({ id: 'r1' }), dedupeKey: 'reminder:g1' }), opts());
    await run(upsertScheduledJobStatement({ ...job({ id: 'r2', runAfter: at(60), payload: '{"v":1,"x":2}' }), dedupeKey: 'reminder:g1' }), opts());
    expect(await getJob('r1', opts())).toMatchObject({ run_after: at(60), payload: { v: 1, x: 2 } });
    expect(await getJob('r2', opts())).toBeNull();
    await run(statement("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = 'r1'", [at(61)]), opts());
    await run(upsertScheduledJobStatement({ ...job({ id: 'r3', runAfter: at(120) }), dedupeKey: 'reminder:g1' }), opts());
    expect(await getJob('r1', opts())).toMatchObject({ status: 'done', run_after: at(60) });
  });

  it('cancel by ref (and kind) touches only pending jobs and frees the key', async () => {
    const pending = await enqueue({ ref: 'gallery:1', dedupeKey: 'reminder:1' });
    const other = await enqueue({ ref: 'gallery:1', kind: 'other' });
    const running = await enqueue({ ref: 'gallery:1', runAfter: at(-1) });
    await run(statement("UPDATE jobs SET status = 'running', attempts = 1 WHERE id = ?", [running]), opts());
    await run(cancelPendingJobsStatement({ ref: 'gallery:1', kind: 'test.ok', now: at(1) }), opts());
    expect(await getJob(pending, opts())).toMatchObject({ status: 'failed', last_error: 'CANCELLED', dedupe_key: null, finished_at: at(1) });
    expect(await status(other)).toBe('pending');
    expect(await status(running)).toBe('running');
    // The key is free for a new schedule.
    expect((await run(enqueueJobStatement(job({ dedupeKey: 'reminder:1' })), opts())).changes).toBe(1);
  });
});

describe('claim', () => {
  it('takes priority first, then the earliest due; skips not due, running, done and failed', async () => {
    await enqueue({ id: 'later', runAfter: at(5) });
    await enqueue({ id: 'bulk', priority: 1, runAfter: at(-10) });
    await enqueue({ id: 'second', runAfter: at(-1) });
    await enqueue({ id: 'first', runAfter: at(-2) });
    await enqueue({ id: 'done', runAfter: at(-30) });
    await run(statement("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = 'done'", [at(0)]), opts());
    const order = [];
    for (let i = 0; i < 5; i++) order.push((await claim())?.id ?? null);
    expect(order).toEqual(['first', 'second', 'bulk', null, null]);
    expect(await getJob('first', opts())).toMatchObject({ status: 'running', attempts: 1, run_after: at(2) });
  });

  it('returns what the runner needs', async () => {
    await enqueue({ id: 'x', payload: '{"v":1,"a":"b"}' });
    expect(await claim()).toEqual({ id: 'x', kind: 'test.ok', payload: { v: 1, a: 'b' }, attempts: 1, max_attempts: 3, last_error: null, created_at: at(0) });
  });

  it('parallel claims never hand out the same job', async () => {
    for (let i = 0; i < 8; i++) await enqueue();
    const claimed = await Promise.all(Array.from({ length: 12 }, () => claim()));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('never selects a row whose attempts reached max_attempts', async () => {
    await enqueue({ id: 'spent', maxAttempts: 2 });
    await run(statement("UPDATE jobs SET attempts = 2 WHERE id = 'spent'"), opts());
    expect(await claim()).toBeNull();
  });
});

describe('finishing writes are fenced by the attempt', () => {
  async function claimed(maxAttempts = 3) {
    await enqueue({ id: 'f', maxAttempts, payload: '{"v":1,"params":{"name":"A"}}' });
    return (await claim())!;
  }

  it('done: once, dropping what the runner passes; a stale attempt changes nothing', async () => {
    const j = await claimed();
    expect(await completeJob({ id: 'f', attempts: j.attempts + 1, now: at(1), payload: null }, opts())).toBe(false);
    expect(await completeJob({ id: 'f', attempts: j.attempts, now: at(1), payload: '{"v":1}' }, opts())).toBe(true);
    expect(await getJob('f', opts())).toMatchObject({ status: 'done', finished_at: at(1), payload: { v: 1 }, last_error: null });
    expect(await completeJob({ id: 'f', attempts: j.attempts, now: at(2), payload: null }, opts())).toBe(false);
  });

  it('retry later, then fail; a null payload keeps the stored one', async () => {
    const j = await claimed();
    expect(await rescheduleJob({ id: 'f', attempts: j.attempts, now: at(1), runAfter: at(5), lastError: 'SMTP_451' }, opts())).toBe(true);
    expect(await getJob('f', opts())).toMatchObject({ status: 'pending', run_after: at(5), last_error: 'SMTP_451', attempts: 1 });
    const again = (await claim(5))!;
    expect(again.attempts).toBe(2);
    expect(await failJob({ id: 'f', attempts: 1, now: at(6), lastError: 'X', payload: null }, opts())).toBe(false);
    expect(await failJob({ id: 'f', attempts: 2, now: at(6), lastError: 'SMTP_550', payload: null }, opts())).toBe(true);
    expect(await getJob('f', opts())).toMatchObject({ status: 'failed', finished_at: at(6), last_error: 'SMTP_550', payload: { v: 1, params: { name: 'A' } } });
  });

  it('defer gives the attempt back, so a job deferred again and again never breaks the CHECK', async () => {
    await enqueue({ id: 'd', maxAttempts: 1 });
    for (let i = 0; i < 7; i++) {
      const j = (await claim(i * 20))!;
      expect(j.attempts).toBe(1);
      expect(await deferJob({ id: 'd', attempts: 1, now: at(i * 20), runAfter: at(i * 20 + 10), code: 'UNKNOWN_KIND' }, opts())).toBe(true);
    }
    expect(await getJob('d', opts())).toMatchObject({ status: 'pending', attempts: 0, last_error: 'UNKNOWN_KIND' });
  });
});

describe('leases', () => {
  it('an expired lease goes back to pending 10 minutes later, or fails when no attempt is left', async () => {
    await enqueue({ id: 'again', maxAttempts: 3 });
    await enqueue({ id: 'spent', maxAttempts: 1 });
    await claim();
    await claim();
    expect(await expireLeases({ now: at(1), retryAt: at(11) }, opts())).toBe(0); // leases run to at(2)
    expect(await expireLeases({ now: at(3), retryAt: at(13) }, opts())).toBe(2);
    expect(await getJob('again', opts())).toMatchObject({ status: 'pending', run_after: at(13), last_error: 'LEASE_EXPIRED', finished_at: null });
    expect(await getJob('spent', opts())).toMatchObject({ status: 'failed', finished_at: at(3), last_error: 'LEASE_EXPIRED' });
    expect(await claim(12)).toBeNull();
    expect((await claim(13))?.last_error).toBe('LEASE_EXPIRED');
  });
});

describe('housekeeping', () => {
  it('expires pending jobs due for 7 days; a retried old job is not caught', async () => {
    await enqueue({ id: 'old', runAfter: at(-8 * 24 * 60) });
    await enqueue({ id: 'retried', now: at(-8 * 24 * 60), runAfter: at(-60) });
    expect(await expireStaleJobs({ before: at(-7 * 24 * 60), now: at(0) }, opts())).toBe(1);
    expect(await getJob('old', opts())).toMatchObject({ status: 'failed', last_error: 'EXPIRED' });
    expect(await status('retried')).toBe('pending');
  });

  it('prunes only finished jobs older than the cut, oldest first, bounded', async () => {
    for (const [id, minutes] of [['a', -100], ['b', -90], ['c', -80], ['young', -1]] as const) {
      await enqueue({ id });
      await run(statement("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = ?", [at(minutes), id]), opts());
    }
    await enqueue({ id: 'pending' });
    expect(await pruneFinishedJobs({ before: at(-10), limit: 2 }, opts())).toBe(2);
    expect((await all<{ id: string }>(statement('SELECT id FROM jobs ORDER BY id'), opts())).map((r) => r.id)).toEqual(['c', 'pending', 'young']);
  });
});

describe('the table refuses bad rows', () => {
  it.each([
    ['an upper-case kind', { kind: 'Email' }],
    ['a dash in the kind', { kind: 'a-b' }],
    ['an empty kind', { kind: '' }],
    ['invalid JSON', { payload: '{nope' }],
    ['priority 2', { priority: 2 as 0 }],
    ['max_attempts 0', { maxAttempts: 0 }],
    ['max_attempts 21', { maxAttempts: 21 }],
    ['run_after without ms', { runAfter: '2026-11-16T10:00:00Z' }],
    ['run_after as a date', { runAfter: '2026-11-16' }],
  ])('%s', async (_name, over) => {
    await expect(run(enqueueJobStatement(job(over)), opts())).rejects.toThrow();
  });

  it('accepts the kinds the plan names', async () => {
    for (const kind of ['email', 'housekeeping', 'r2.sweep', 'test_1']) await enqueue({ kind });
  });

  it.each([
    ['attempts over max', "UPDATE jobs SET attempts = 4 WHERE id = 'x'"],
    ['an unknown status', "UPDATE jobs SET status = 'paused' WHERE id = 'x'"],
    ['done without finished_at', "UPDATE jobs SET status = 'done' WHERE id = 'x'"],
    ['finished_at while pending', "UPDATE jobs SET finished_at = '2026-11-16T10:00:00.000Z' WHERE id = 'x'"],
  ])('%s', async (_name, sql) => {
    await enqueue({ id: 'x' });
    await expect(run(statement(sql), opts())).rejects.toThrow();
  });
});
