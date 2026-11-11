import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { getSiteSetting, listSiteSettings, upsertSiteSetting, upsertSiteSettingStatement } from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

describe('site_settings queries', () => {
  it('inserts, reads back parsed JSON and an ISO-8601 UTC timestamp', async () => {
    const created = await upsertSiteSetting('branding', { studioName: 'North Light' }, opts());
    expect(created).toMatchObject({ key: 'branding', value: { studioName: 'North Light' } });
    expect(created.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await getSiteSetting('branding', opts())).toEqual(created);
  });

  it('overwrites on the second upsert', async () => {
    await upsertSiteSetting('branding', { studioName: 'old' }, opts());
    await upsertSiteSetting('branding', { studioName: 'new' }, opts());
    expect(await listSiteSettings(opts())).toEqual([expect.objectContaining({ key: 'branding', value: { studioName: 'new' } })]);
  });

  it('returns null for a missing key', async () => {
    expect(await getSiteSetting('nope', opts())).toBeNull();
  });

  it('enforces the key shape in the schema, and a failed batch writes nothing', async () => {
    await expect(
      batch([upsertSiteSettingStatement('seo', { title: 'x' }, opts()), upsertSiteSettingStatement('Bad Key', 1, opts())], opts()),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await listSiteSettings(opts())).toEqual([]);
  });
});
