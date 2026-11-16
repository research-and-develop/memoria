import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { logger } from '@repo/logger';
import { MailError } from '@repo/platform/mail/error';
import { memoryMailer, type MemoryMailer } from '@repo/platform/memory/mailer';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { enqueueJobStatement, getJob } from '@/lib/db/queries/jobs';

import { LEASE_MS, RETRY_LATER_MS, runDueJobs, UNKNOWN_KIND_AFTER_MS, type DrainTrigger } from './runner';
import { JobError, type AnyJobKind, type JobContext, type JobKind } from './types';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => useTestPlatform({ db: testDb.db }));
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const T0 = Date.parse('2026-11-16T10:00:00.000Z');
let nowMs = T0;
const clock = () => new Date(nowMs);
const iso = (ms: number) => new Date(ms).toISOString();

const calls: string[] = [];
let release: (() => void) | null = null;
const kind = (name: string, runImpl: (ctx: JobContext) => Promise<void>, over: Partial<JobKind<unknown>> = {}): AnyJobKind => ({
  kind: name,
  version: 1,
  maxAttempts: 3,
  priority: 0,
  backoff: [1, 5],
  parse: (p) => (p.bad ? { ok: false, unknown: false } : p.template === 'future' ? { ok: false, unknown: true } : { ok: true, value: p }),
  run: async (_payload, ctx) => {
    calls.push(`${name}#${ctx.attempt}`);
    await runImpl(ctx);
  },
  ...over,
});
const REGISTRY: AnyJobKind[] = [
  kind('test.ok', async () => {}),
  kind('test.transient', async () => {
    throw new JobError('X_TRANSIENT', { detail: 'try again' });
  }),
  kind('test.permanent', async () => {
    throw new JobError('X_PERMANENT', { permanent: true });
  }),
  kind('test.hang', () => new Promise<void>((resolve) => (release = resolve))),
  kind('test.mail', async (ctx) => {
    await ctx.mailerFor({ provider: 'brevo', brevo: { apiKey: 'test' } }).send({ id: ctx.jobId, from: { email: 's@example.com' }, to: { email: 'client@example.com' }, subject: 's', text: 't', html: 'h' }, { signal: ctx.signal });
  }),
  kind('test.throws', async () => {
    throw new Error('boom for someone@example.com');
  }),
];

let mailer: MemoryMailer;
beforeEach(() => {
  nowMs = T0;
  calls.length = 0;
  release = null;
  mailer = memoryMailer();
});

const drain = (trigger: DrainTrigger = 'nudge', over: { handlerCapMs?: number; clock?: () => Date } = {}) =>
  runDueJobs({ mailerFor: () => mailer, trigger, clock, registry: REGISTRY, ...over });
let seq = 0;
async function enqueue(kindName: string, over: { payload?: Record<string, unknown>; maxAttempts?: number; createdMs?: number; runAfterMs?: number } = {}) {
  const id = `job-${++seq}`;
  await run(
    enqueueJobStatement({
      id,
      kind: kindName,
      payload: JSON.stringify({ v: 1, ...over.payload }),
      priority: 0,
      maxAttempts: over.maxAttempts ?? 3,
      runAfter: iso(over.runAfterMs ?? nowMs),
      now: iso(over.createdMs ?? nowMs),
    }),
  );
  return id;
}

describe('runDueJobs', () => {
  it('success → done, params dropped from the payload', async () => {
    const id = await enqueue('test.ok', { payload: { params: { name: 'Maria' } } });
    expect(await drain()).toMatchObject({ claimed: 1, done: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'done', attempts: 1, payload: { v: 1 }, last_error: null, finished_at: iso(T0) });
  });

  it('transient → pending at the backoff with the reason; the last attempt → failed', async () => {
    const id = await enqueue('test.transient', { maxAttempts: 2 });
    expect(await drain()).toMatchObject({ retried: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'pending', run_after: iso(T0 + 60_000), last_error: 'X_TRANSIENT: try again' });
    expect(await drain()).toMatchObject({ claimed: 0 }); // not due yet
    nowMs = T0 + 60_000;
    expect(await drain()).toMatchObject({ failed: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'failed', attempts: 2, last_error: 'X_TRANSIENT: try again' });
  });

  it('permanent → failed at once', async () => {
    const id = await enqueue('test.permanent');
    await drain();
    expect(await getJob(id)).toMatchObject({ status: 'failed', attempts: 1, last_error: 'X_PERMANENT' });
  });

  it("a mailer's configuration error retries and is logged as an error", async () => {
    const error = vi.spyOn(logger, 'error');
    mailer.failWith(new MailError('SMTP_535', { configuration: true, retryAfterSeconds: 600 }));
    const id = await enqueue('test.mail');
    await drain();
    // Retry-After (10 min) beats the first step (1 min).
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'SMTP_535', run_after: iso(T0 + 600_000) });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'job_retry', code: 'SMTP_535' }));
  });

  it('an unknown error keeps only its name (its message may hold an address)', async () => {
    const id = await enqueue('test.throws');
    await drain();
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'JOB_ERROR: Error' });
  });

  it('unknown kind, unknown template or newer v → back in 10 min without spending an attempt; UNKNOWN_KIND after a day', async () => {
    const unknown = await enqueue('test.nobody');
    const template = await enqueue('test.ok', { payload: { template: 'future' } });
    const newer = await run(
      enqueueJobStatement({ id: 'newer', kind: 'test.ok', payload: '{"v":2}', priority: 0, maxAttempts: 3, runAfter: iso(T0), now: iso(T0) }),
    ).then(() => 'newer');
    for (const id of [unknown, template, newer]) {
      expect(await drain()).toMatchObject({ deferred: 1 });
      expect(await getJob(id)).toMatchObject({ status: 'pending', attempts: 0, run_after: iso(T0 + RETRY_LATER_MS), last_error: 'UNKNOWN_KIND' });
    }
    expect(calls).toEqual([]);
    nowMs = T0 + UNKNOWN_KIND_AFTER_MS + 1;
    await drain();
    await drain();
    await drain();
    for (const id of [unknown, template, newer]) expect(await getJob(id)).toMatchObject({ status: 'failed', last_error: 'UNKNOWN_KIND' });
  });

  it('a deferred job never jams the queue: the next one still runs', async () => {
    await enqueue('test.nobody', { maxAttempts: 1 });
    const ok = await enqueue('test.ok', { runAfterMs: T0 + 1 });
    nowMs = T0 + 1;
    await drain(); // defers the unknown one
    await drain(); // runs the next
    expect(await getJob(ok)).toMatchObject({ status: 'done' });
  });

  it('a payload that does not parse → JOB_INVALID', async () => {
    const id = await enqueue('test.ok', { payload: { bad: true } });
    await drain();
    expect(await getJob(id)).toMatchObject({ status: 'failed', last_error: 'JOB_INVALID' });
  });

  it('one job per nudge and per cron', async () => {
    await enqueue('test.ok');
    await enqueue('test.ok');
    await enqueue('test.ok');
    expect(await drain('nudge')).toMatchObject({ claimed: 1 });
    expect(await drain('cron')).toMatchObject({ claimed: 1 });
    expect(calls).toHaveLength(2);
  });

  it('starts no job with less than 20 s of budget left', async () => {
    await enqueue('test.ok');
    let first = true;
    const late = () => {
      const t = first ? T0 : T0 + 10_000; // the drain started 10 s ago: 15 s of the nudge's 25 s left
      first = false;
      return new Date(t);
    };
    expect(await drain('nudge', { clock: late })).toMatchObject({ claimed: 0 });
  });

  it('a hanging handler is aborted at its cap and retried; its late completion writes nothing', async () => {
    const id = await enqueue('test.hang');
    expect(await drain('nudge', { handlerCapMs: 30 })).toMatchObject({ retried: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'JOB_TIMEOUT' });
    release?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(await getJob(id)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'JOB_TIMEOUT' });
  });

  it('a reclaimed job logs job_reclaimed; a stale finish logs job_lease_lost', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const id = await enqueue('test.hang');
    // A runner claims it and dies (we never finish it): its lease runs out.
    await run(statement("UPDATE jobs SET status = 'running', attempts = 1, run_after = ? WHERE id = ?", [iso(T0 + LEASE_MS), id]));
    nowMs = T0 + LEASE_MS;
    await drain(); // hands the lease back (+10 min), claims nothing due
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'LEASE_EXPIRED' });
    nowMs += RETRY_LATER_MS;
    const draining = drain('nudge', { handlerCapMs: 200 });
    await vi.waitFor(() => expect(calls).toEqual(['test.hang#2']));
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'job_reclaimed', jobId: id, attempt: 2 }));
    // Meanwhile another runner moved it on (its lease was taken over): this finish must not land.
    await run(statement("UPDATE jobs SET attempts = 3 WHERE id = ?", [id]));
    release?.();
    expect(await draining).toMatchObject({ leaseLost: 1 });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'job_lease_lost', jobId: id }));
  });

  it('two drains at once share the queue without running a job twice', async () => {
    const ids = [await enqueue('test.ok'), await enqueue('test.ok')];
    await Promise.all([drain(), drain()]);
    expect(calls.sort()).toEqual(['test.ok#1', 'test.ok#1']);
    for (const id of ids) expect(await getJob(id)).toMatchObject({ status: 'done' });
  });

  it('a drain error is logged, not thrown', async () => {
    const error = vi.spyOn(logger, 'error');
    useTestPlatform({}); // no database
    await expect(drain()).resolves.toMatchObject({ claimed: 0 });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'relay_drain_failed', trigger: 'nudge' }));
  });

  it('idle: no log line and no write', async () => {
    const info = vi.spyOn(logger, 'info');
    await drain();
    await drain('cron');
    expect(info).not.toHaveBeenCalled();
    expect(await all(statement('SELECT id FROM jobs'))).toEqual([]);
  });

  it('logs never contain an address or a parameter', async () => {
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) => vi.spyOn(logger, level));
    mailer.failWith(new MailError('SMTP_550', { permanent: true, detail: 'rejected <***>' }));
    await enqueue('test.mail', { payload: { params: { email: 'maria@example.com', name: 'Maria' } } });
    await enqueue('test.throws');
    await drain();
    await drain();
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).toContain('job_failed');
    expect(logged).not.toMatch(/@|Maria/);
  });
});
