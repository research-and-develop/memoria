import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { memoryMailer } from '@repo/platform/memory/mailer';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { enqueuePeriodicJobs } from './periodic';
import { runDueJobs } from './runner';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => useTestPlatform({ db: testDb.db }));
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const NOW = Date.parse('2026-11-16T03:05:00.000Z');
const days = (n: number) => new Date(NOW - n * 24 * 60 * 60_000).toISOString();
const insert = (id: string, status: string, runAfter: string, finishedAt: string | null) =>
  run(
    statement("INSERT INTO jobs (id, kind, payload, status, max_attempts, run_after, finished_at) VALUES (?, 'email', '{}', ?, 3, ?, ?)", [id, status, runAfter, finishedAt]),
  );

describe('the housekeeping job, end to end', () => {
  it('the cron enqueues it, the runner runs it: stale pending fail EXPIRED, old finished go', async () => {
    await insert('stale', 'pending', days(8), null);
    await insert('fresh', 'pending', days(1), null);
    await insert('old-done', 'done', days(40), days(40));
    await insert('recent-done', 'done', days(2), days(2));
    expect(await enqueuePeriodicJobs(new Date(NOW))).toBe(true);
    // The two pending emails are due too and would be claimed first (priority 0, older): make
    // housekeeping the next job, keeping 'stale' due for 8 days and 'fresh' pending.
    await run(statement("UPDATE jobs SET run_after = ? WHERE id = 'fresh'", [new Date(NOW + 60_000).toISOString()]));
    await run(statement("UPDATE jobs SET priority = 1, run_after = ? WHERE id = 'stale'", [days(8)]));
    await run(statement("UPDATE jobs SET priority = 0 WHERE kind = 'housekeeping'"));
    const summary = await runDueJobs({ mailerFor: () => memoryMailer(), trigger: 'cron', clock: () => new Date(NOW) });
    expect(summary).toMatchObject({ claimed: 1, done: 1 });
    const rows = await all<{ id: string; status: string; last_error: string | null }>(statement("SELECT id, status, last_error FROM jobs WHERE kind = 'email' ORDER BY id"));
    expect(rows).toEqual([
      { id: 'fresh', status: 'pending', last_error: null },
      { id: 'recent-done', status: 'done', last_error: null },
      { id: 'stale', status: 'failed', last_error: 'EXPIRED' },
    ]);
  });
});
