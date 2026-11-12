import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { hitRateLimits, isOverLimit, type RateRule } from './rateLimit';

let testDb: TestDb;
const NOW = new Date('2026-06-15T10:22:30.000Z');
const opts = () => ({ db: testDb.db, now: NOW });
const RULE: RateRule = { bucket: 'test:fail', limit: 3, windowSeconds: 24 * 3600 };

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

describe('isOverLimit', () => {
  it('is false below the limit and true from exactly the limit', async () => {
    expect(await isOverLimit(RULE, opts())).toBe(false);
    for (let i = 1; i <= 3; i++) {
      await hitRateLimits([RULE], opts());
      expect(await isOverLimit(RULE, opts())).toBe(i >= 3);
    }
  });

  it('writes nothing', async () => {
    await isOverLimit(RULE, opts());
    expect(await all(statement('SELECT * FROM rate_limits'), { db: testDb.db })).toEqual([]);
  });

  it('starts over in the next window', async () => {
    for (let i = 0; i < 3; i++) await hitRateLimits([RULE], opts());
    expect(await isOverLimit(RULE, { db: testDb.db, now: new Date('2026-06-16T00:00:01.000Z') })).toBe(false);
  });
});
