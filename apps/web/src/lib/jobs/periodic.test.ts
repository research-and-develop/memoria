import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { enqueuePeriodicJobs } from './periodic';

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

const jobs = () => all<{ kind: string; dedupe_key: string; priority: number; payload: string }>(statement('SELECT kind, dedupe_key, priority, payload FROM jobs ORDER BY dedupe_key'));

describe('enqueuePeriodicJobs', () => {
  it('before 03:00 UTC: nothing', async () => {
    expect(await enqueuePeriodicJobs(new Date('2026-11-16T02:59:59.999Z'))).toBe(false);
    expect(await jobs()).toEqual([]);
  });

  it("from 03:00 UTC: the day's housekeeping job, once however many ticks", async () => {
    for (const time of ['03:00:00', '03:01:00', '14:30:00', '23:59:00']) await enqueuePeriodicJobs(new Date(`2026-11-16T${time}.000Z`));
    expect(await jobs()).toEqual([{ kind: 'housekeeping', dedupe_key: 'housekeeping:2026-11-16', priority: 1, payload: '{"v":1}' }]);
  });

  it('a new UTC day: a new job', async () => {
    await enqueuePeriodicJobs(new Date('2026-11-16T03:05:00.000Z'));
    await enqueuePeriodicJobs(new Date('2026-11-17T03:05:00.000Z'));
    expect((await jobs()).map((j) => j.dedupe_key)).toEqual(['housekeeping:2026-11-16', 'housekeeping:2026-11-17']);
  });
});
