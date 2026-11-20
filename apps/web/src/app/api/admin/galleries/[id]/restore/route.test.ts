import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getGallery } from '@/lib/db/queries/galleries';
import { makeGallery } from '@/lib/testing/galleryHarness';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST: RESTORE } = await import('./route');
const { DELETE, GET } = await import('../route');

/** Delete and restore (plan p05, D5.17): soft at once, the purge 7 days later, restore cancels it. */
let testDb: TestDb;
let passwordHash: string;
let cookie: string;
const db = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(async () => {
  useTestPlatform({
    db: testDb.db,
    env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 },
  });
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const del = (id: string, c = cookie) => DELETE(jsonRequest(`/api/admin/galleries/${id}`, undefined, { method: 'DELETE', cookie: c }), params({ id }));
const restore = (id: string) => RESTORE(jsonRequest(`/api/admin/galleries/${id}/restore`, {}, { cookie }), params({ id }));
const purgeJobs = (id: string) =>
  all<{ status: string; run_after: string; last_error: string | null }>(statement(`SELECT status, run_after, last_error FROM jobs WHERE kind = 'gallery.purge' AND ref = ?`, [`gallery:${id}`]), db());

describe('DELETE /api/admin/galleries/[id] and POST …/restore', () => {
  it('deletes softly with a purge in 7 days; restore brings it back and cancels the purge', async () => {
    const { id } = await makeGallery(testDb.db);
    const res = await del(id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { purgeAt: string } };
    const gallery = await getGallery(id, db());
    expect(gallery?.deleted_at).not.toBeNull();
    expect(Date.parse(data.purgeAt) - Date.parse(gallery!.deleted_at!)).toBe(7 * 24 * 3600 * 1000);
    expect(await purgeJobs(id)).toEqual([{ status: 'pending', run_after: data.purgeAt, last_error: null }]);
    // Gone for the manager; a second delete is a 404.
    expect((await GET(jsonRequest(`/api/admin/galleries/${id}`, undefined, { cookie }), params({ id }))).status).toBe(404);
    expect((await del(id)).status).toBe(404);

    expect((await restore(id)).status).toBe(200);
    expect((await getGallery(id, db()))?.deleted_at).toBeNull();
    expect(await purgeJobs(id)).toEqual([{ status: 'failed', run_after: data.purgeAt, last_error: 'CANCELLED' }]);
    // A live gallery has nothing to restore.
    expect((await restore(id)).status).toBe(404);
    // Deleted again: a fresh purge (the cancelled one is not alive).
    expect((await del(id)).status).toBe(200);
    expect((await purgeJobs(id)).filter((j) => j.status === 'pending')).toHaveLength(1);
  });

  it('409 once the window has passed; the purge is left in place', async () => {
    const { id } = await makeGallery(testDb.db);
    await del(id);
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [old, id]), db());
    const res = await restore(id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe('RESTORE_WINDOW_PASSED');
    expect((await purgeJobs(id)).map((j) => j.status)).toEqual(['pending']);
  });

  it('needs an admin; 404 for an unknown id', async () => {
    const { id } = await makeGallery(testDb.db);
    expect((await del(id, '')).status).toBe(401);
    expect((await getGallery(id, db()))?.deleted_at).toBeNull();
    expect((await restore('00000000-0000-4000-8000-00000000abcd')).status).toBe(404);
  });
});
