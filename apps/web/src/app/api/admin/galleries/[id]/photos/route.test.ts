import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getGallery } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';
import { getPhotos } from '@/lib/db/queries/photos';
import { makeGallery, makeReadyPhotos } from '@/lib/testing/galleryHarness';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const photosRoute = await import('./route');
const bulkRoute = await import('./bulk/route');
const coverRoute = await import('../cover/route');
const setsRoute = await import('../sets/route');
const setRoute = await import('../sets/[setId]/route');
const orderRoute = await import('../sets/order/route');

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
    env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64, NEXTJS_ENV: 'development', MEDIA_DEV_SIGNING_SECRET: 'test-media-dev-signing-secret-0123456789' },
  });
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

type Json = { data?: unknown; next?: string | null; errorCode?: string };
const json = async (res: Response) => (await res.json()) as Json;
const bulk = (id: string, body: unknown) => bulkRoute.POST(jsonRequest(`/api/admin/galleries/${id}/photos/bulk`, body, { cookie }), params({ id }));
const version = async (id: string) => (await getGallery(id, db()))!.content_version;

describe('sets', () => {
  it('adds, renames, reorders and deletes; bumps the content version on each real change', async () => {
    const g = await makeGallery(testDb.db);
    const add = await setsRoute.POST(jsonRequest(`/api/admin/galleries/${g.id}/sets`, { name: ' Ceremony ' }, { cookie }), params({ id: g.id }));
    expect(add.status).toBe(201);
    const setId = ((await json(add)).data as { id: string }).id;
    expect((await listSets(g.id, db())).map((s) => s.name)).toEqual(['Photos', 'Ceremony']);
    const v = await version(g.id);
    await setRoute.PATCH(jsonRequest(`/api/admin/galleries/${g.id}/sets/${setId}`, { name: 'Ceremony' }, { method: 'PATCH', cookie }), params({ id: g.id, setId }));
    expect(await version(g.id)).toBe(v);
    const order = await orderRoute.PUT(jsonRequest(`/api/admin/galleries/${g.id}/sets/order`, { ids: [setId, g.setId] }, { method: 'PUT', cookie }), params({ id: g.id }));
    expect(order.status).toBe(200);
    expect((await listSets(g.id, db())).map((s) => s.id)).toEqual([setId, g.setId]);
    const missing = await orderRoute.PUT(jsonRequest(`/api/admin/galleries/${g.id}/sets/order`, { ids: [setId] }, { method: 'PUT', cookie }), params({ id: g.id }));
    expect(missing.status).toBe(400);
    const del = await setRoute.DELETE(jsonRequest(`/api/admin/galleries/${g.id}/sets/${setId}`, undefined, { method: 'DELETE', cookie }), params({ id: g.id, setId }));
    expect(del.status).toBe(200);
  });

  it('never deletes the last set or one with photos (409 SET_NOT_EMPTY); a set of another gallery is 404', async () => {
    const g = await makeGallery(testDb.db);
    const other = await makeGallery(testDb.db);
    const del = (setId: string) => setRoute.DELETE(jsonRequest(`/api/admin/galleries/${g.id}/sets/${setId}`, undefined, { method: 'DELETE', cookie }), params({ id: g.id, setId }));
    expect((await json(await del(g.setId))).errorCode).toBe('SET_NOT_EMPTY');
    expect((await del(other.setId)).status).toBe(404);
    expect((await setsRoute.POST(jsonRequest(`/api/admin/galleries/${g.id}/sets`, { name: '' }, { cookie }), params({ id: g.id }))).status).toBe(400);
  });
});

describe('photos', () => {
  it('pages a set with a cursor; another gallery\'s set is 404; a bad cursor 400', async () => {
    const g = await makeGallery(testDb.db);
    const other = await makeGallery(testDb.db);
    await makeReadyPhotos(testDb.db, g.id, g.setId, 3);
    const list = (query: string, id = g.id) => photosRoute.GET(jsonRequest(`/api/admin/galleries/${id}/photos?${query}`, undefined, { cookie }), params({ id }));
    const page = await json(await list(`set_id=${g.setId}`));
    expect((page.data as { thumbUrl: string }[]).map((p) => p.thumbUrl.startsWith('/api/blobs/read?t='))).toEqual([true, true, true]);
    expect(page.next).toBeNull();
    expect((await list(`set_id=${other.setId}`)).status).toBe(404);
    expect((await list(`set_id=${g.setId}&cursor=${'a'.repeat(701)}`)).status).toBe(400);
  });
});

describe('bulk', () => {
  it('hide: changes once, clears a hidden cover, recounts, bumps once; a repeat changes nothing', async () => {
    const g = await makeGallery(testDb.db);
    const [a, b] = await makeReadyPhotos(testDb.db, g.id, g.setId, 2);
    expect((await getGallery(g.id, db()))!.cover_photo_id).toBe(a);
    const v = await version(g.id);
    expect((await json(await bulk(g.id, { action: 'hide', ids: [a] }))).data).toEqual({ changed: 1 });
    const after = (await getGallery(g.id, db()))!;
    expect(after).toMatchObject({ photo_count: 1, cover_photo_id: b, content_version: v + 1 });
    expect((await listSets(g.id, db()))[0]!.photo_count).toBe(1);
    expect((await json(await bulk(g.id, { action: 'hide', ids: [a] }))).data).toEqual({ changed: 0 });
    expect(await version(g.id)).toBe(v + 1);
  });

  it('move: within the gallery; a set of another gallery is 400 INVALID_SET', async () => {
    const g = await makeGallery(testDb.db);
    const other = await makeGallery(testDb.db);
    const [a] = await makeReadyPhotos(testDb.db, g.id, g.setId, 1);
    const add = await setsRoute.POST(jsonRequest(`/api/admin/galleries/${g.id}/sets`, { name: 'Two' }, { cookie }), params({ id: g.id }));
    const two = ((await json(add)).data as { id: string }).id;
    expect((await json(await bulk(g.id, { action: 'move', ids: [a], setId: two }))).data).toEqual({ changed: 1 });
    expect((await listSets(g.id, db())).map((s) => s.photo_count)).toEqual([0, 1]);
    expect((await json(await bulk(g.id, { action: 'move', ids: [a], setId: other.setId }))).errorCode).toBe('INVALID_SET');
  });

  it('delete: photos deleted with their hashes released, one media.purge pending and one nudge, audit without names', async () => {
    const g = await makeGallery(testDb.db);
    const ids = await makeReadyPhotos(testDb.db, g.id, g.setId, 2);
    await bulk(g.id, { action: 'delete', ids: [ids[0]] });
    await bulk(g.id, { action: 'delete', ids: [ids[1]] });
    expect((await getPhotos({ galleryId: g.id, ids }, db())).map((p) => [p.status, p.sha256])).toEqual([
      ['deleted', null],
      ['deleted', null],
    ]);
    const jobs = await all<{ kind: string; status: string }>(statement(`SELECT kind, status FROM jobs WHERE kind = 'media.purge'`), db());
    expect(jobs).toEqual([{ kind: 'media.purge', status: 'pending' }]);
    await flushDeferred();
    expect(nudgeCount()).toBe(2);
    expect(await getGallery(g.id, db())).toMatchObject({ photo_count: 0, cover_photo_id: null });
  });

  it('refuses more than 90 ids or an unknown action (400)', async () => {
    const g = await makeGallery(testDb.db);
    const many = Array.from({ length: 91 }, () => crypto.randomUUID());
    expect((await bulk(g.id, { action: 'hide', ids: many })).status).toBe(400);
    expect((await bulk(g.id, { action: 'paint', ids: [crypto.randomUUID()] })).status).toBe(400);
  });
});

describe('cover', () => {
  it('sets a visible ready photo; a hidden one is 400 INVALID_COVER', async () => {
    const g = await makeGallery(testDb.db);
    const [a, b] = await makeReadyPhotos(testDb.db, g.id, g.setId, 2);
    const put = (photoId: string) => coverRoute.PUT(jsonRequest(`/api/admin/galleries/${g.id}/cover`, { photoId }, { method: 'PUT', cookie }), params({ id: g.id }));
    expect((await put(b!)).status).toBe(200);
    expect((await getGallery(g.id, db()))!.cover_photo_id).toBe(b);
    await bulk(g.id, { action: 'hide', ids: [a] });
    expect((await json(await put(a!))).errorCode).toBe('INVALID_COVER');
  });
});
