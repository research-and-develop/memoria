import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { all, batch, run, statement, type Statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { insertGalleryStatement, updateGalleryStatement } from '../galleries';
import { at, galleryInsert, hash, photoUpload, uuid } from '../galleries/testFixtures';
import { insertSetStatement } from '../photo_sets';
import {
  bulkDeleteStatement,
  bulkHideStatement,
  bulkMoveStatement,
  claimStaleUploadsStatement,
  deletePhotosStatement,
  findPhotosByHash,
  getPhotos,
  insertUploadingPhotoStatement,
  listPurgeablePhotos,
  listSetPhotos,
  markReadyStatement,
  remintPhotoStatement,
  resortStatement,
  type PhotoUpload,
} from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const changes = async (s: Statement) => (await run(s, opts())).changes;

async function newGallery(sort: 'filename' | 'taken' = 'filename') {
  const g = galleryInsert({ settings: { sort } });
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) })], opts());
  return { id: g.id, setId };
}

const register = async (p: PhotoUpload) => (await batch<{ id: string }>([insertUploadingPhotoStatement(p)], opts()))[0]!.rows;
const ready = (galleryId: string, id: string, batchNow = at(1)) => run(markReadyStatement({ galleryId, id, batchNow }), opts());
const sortKeys = async (setId: string) => (await all<{ id: string; sort_key: string }>(statement('SELECT id, sort_key FROM photos WHERE set_id = ? ORDER BY sort_key', [setId]), opts()));

describe('photos: register', () => {
  it('inserts an uploading row and returns its id; a known hash inserts nothing', async () => {
    const { id, setId } = await newGallery();
    const p = photoUpload(id, setId);
    expect(await register(p)).toEqual([{ id: p.id }]);
    expect(await register(photoUpload(id, setId, { sha256: p.sha256 }))).toEqual([]);
    expect(await findPhotosByHash({ galleryId: id, hashes: [p.sha256] }, opts())).toEqual([
      { id: p.id, sha256: p.sha256, status: 'uploading', rev: p.rev, derivative_ext: 'webp' },
    ]);
    const [row] = await getPhotos({ galleryId: id, ids: [p.id] }, opts());
    expect(row).toMatchObject({ status: 'uploading', hidden: false, meta: { camera: 'X-T5' }, processing: { ext: 'webp' } });
  });

  it('inserts nothing into a soft-deleted gallery', async () => {
    const { id, setId } = await newGallery();
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [at(1), id]), opts());
    expect(await register(photoUpload(id, setId))).toEqual([]);
  });

  it('refuses a set of another gallery (the composite FK) and an unknown gallery', async () => {
    const a = await newGallery();
    const b = await newGallery();
    await expect(register(photoUpload(a.id, b.setId))).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      run(statement(`INSERT INTO photos (id, gallery_id, set_id, filename, name_key, taken_key, sort_key, content_type, original_bytes, bytes, width, height, sha256, rev, derivative_ext, display_width, display_height, color, processing)
        VALUES (?, ?, ?, 'a.jpg', 'a', '~', 'a', 'image/jpeg', 1, 1, 1, 1, ?, 'abcd2345', 'webp', 1, 1, '#000000', '{}')`, [uuid('9d0705'), uuid('9a11e7'), a.setId, hash(1)]), opts()),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it.each([
    ['a type outside the image list', { contentType: 'image/gif' as 'image/png' }],
    ['a short hash', { sha256: 'abc' }],
    ['an upper-case hash', { sha256: 'A'.repeat(64) }],
    ['a bad rev', { rev: 'ABCD0001' }],
    ['a bad extension', { derivativeExt: 'png' as 'webp' }],
    ['an empty filename', { filename: '' }],
    ['a 121-character name key', { nameKey: 'x'.repeat(121) }],
    ['a bad colour', { color: 'red' }],
    ['a zero width', { width: 0 }],
    ['oversized meta', { meta: { note: 'x'.repeat(2100) } }],
  ])('refuses %s', async (_label, over) => {
    const { id, setId } = await newGallery();
    await expect(register(photoUpload(id, setId, over))).rejects.toThrow(/CHECK/);
  });

  it('refuses a NULL hash on a photo that is not deleted (the corrected CHECK)', async () => {
    const { id, setId } = await newGallery();
    const p = photoUpload(id, setId);
    await register(p);
    await expect(run(statement('UPDATE photos SET sha256 = NULL WHERE id = ?', [p.id]), opts())).rejects.toThrow(/CHECK/);
  });

  it('re-mints an uploading row: every field but rev, the key from the NEW name', async () => {
    const { id, setId } = await newGallery();
    const p = photoUpload(id, setId, { nameKey: 'b', filename: 'b.jpg' });
    await register(p);
    expect(await changes(remintPhotoStatement({ ...p, filename: 'a.jpg', nameKey: 'a', rev: 'zzzz9999', derivativeExt: 'jpg', color: '#000000', now: at(5) }))).toBe(1);
    const [row] = await getPhotos({ galleryId: id, ids: [p.id] }, opts());
    expect(row).toMatchObject({ filename: 'a.jpg', rev: p.rev, derivative_ext: 'jpg', color: '#000000', sort_key: `a|~|${p.id}`, updated_at: at(5) });
    await ready(id, p.id);
    expect(await changes(remintPhotoStatement({ ...p, now: at(6) }))).toBe(0);
  });

  it('composes sort_key from the gallery sort; a resort committed between two registrations leaves both in the new order', async () => {
    const { id, setId } = await newGallery('filename');
    const first = photoUpload(id, setId, { nameKey: 'img_0000000002.jpg', takenKey: '2026-10-03T10:00:00' });
    await register(first);
    expect((await sortKeys(setId))[0]!.sort_key).toBe(`img_0000000002.jpg|2026-10-03T10:00:00|${first.id}`);
    await batch([updateGalleryStatement({ id, patch: { settingsPatch: { sort: 'taken' } }, now: at(1) }), resortStatement(id)], opts());
    const second = photoUpload(id, setId, { nameKey: 'img_0000000001.jpg', takenKey: '2026-10-03T11:00:00' });
    await register(second);
    expect((await sortKeys(setId)).map((r) => r.id)).toEqual([first.id, second.id]);
    expect((await sortKeys(setId))[1]!.sort_key).toBe(`2026-10-03T11:00:00|img_0000000001.jpg|${second.id}`);
  });
});

describe('photos: complete, list, bulk', () => {
  it('marks ready only from uploading, once', async () => {
    const { id, setId } = await newGallery();
    const p = photoUpload(id, setId);
    await register(p);
    expect((await ready(id, p.id)).changes).toBe(1);
    expect((await ready(id, p.id)).changes).toBe(0);
  });

  it('lists a set in sort_key order with hidden and uploading photos, pages by the last key, and ignores another gallery', async () => {
    const { id, setId } = await newGallery();
    const other = await newGallery();
    const photos = ['c', 'a', 'b', 'd'].map((k) => photoUpload(id, setId, { nameKey: k }));
    for (const p of photos) await register(p);
    for (const p of photos.slice(0, 3)) await ready(id, p.id);
    await run(bulkHideStatement({ galleryId: id, ids: [photos[1]!.id], hidden: true, batchNow: at(2) }), opts());
    const page1 = await listSetPhotos({ galleryId: id, setId, limit: 2 }, opts());
    expect(page1.map((p) => p.sort_key[0])).toEqual(['a', 'b']);
    expect(page1[0]!.hidden).toBe(true);
    const page2 = await listSetPhotos({ galleryId: id, setId, after: page1[1]!.sort_key }, opts());
    expect(page2.map((p) => p.sort_key[0])).toEqual(['c', 'd']);
    expect(page2[1]!.status).toBe('uploading');
    expect(await listSetPhotos({ galleryId: other.id, setId }, opts())).toEqual([]);
  });

  it('bulk writes touch only this gallery\'s ready photos, skip no-ops, and refuse more than 90 ids', async () => {
    const { id, setId } = await newGallery();
    const other = await newGallery();
    const second = uuid('5e7');
    await run(insertSetStatement({ id: second, galleryId: id, name: 'Two', now: at(0) }), opts());
    const mine = photoUpload(id, setId);
    const uploading = photoUpload(id, setId);
    const theirs = photoUpload(other.id, other.setId);
    for (const p of [mine, uploading, theirs]) await register(p);
    await ready(id, mine.id);
    await ready(other.id, theirs.id);
    const all3 = [mine.id, uploading.id, theirs.id];

    expect(await changes(bulkHideStatement({ galleryId: id, ids: all3, hidden: true, batchNow: at(2) }))).toBe(1);
    expect(await changes(bulkHideStatement({ galleryId: id, ids: all3, hidden: true, batchNow: at(3) }))).toBe(0);
    expect(await changes(bulkMoveStatement({ galleryId: id, ids: all3, setId: second, batchNow: at(4) }))).toBe(1);
    expect(await changes(bulkMoveStatement({ galleryId: id, ids: all3, setId: second, batchNow: at(5) }))).toBe(0);
    await expect(run(bulkMoveStatement({ galleryId: id, ids: [mine.id], setId: other.setId, batchNow: at(6) }), opts())).rejects.toThrow(/FOREIGN KEY/);
    expect(await changes(bulkDeleteStatement({ galleryId: id, ids: all3, batchNow: at(7) }))).toBe(1);
    const [deleted] = await getPhotos({ galleryId: id, ids: [mine.id] }, opts());
    expect(deleted).toMatchObject({ status: 'deleted', sha256: null });
    // A deleted photo's hash is free again: the same file registers anew.
    expect(await register(photoUpload(id, setId, { sha256: mine.sha256 }))).toHaveLength(1);
    const many = Array.from({ length: 91 }, () => uuid('9d0705'));
    expect(() => bulkHideStatement({ galleryId: id, ids: many, hidden: true, batchNow: at(8) })).toThrow(/1–90/);
    expect(bulkHideStatement({ galleryId: id, ids: many.slice(0, 90), hidden: true, batchNow: at(8) }).params.length).toBeLessThanOrEqual(100);
  });
});

describe('photos: purge', () => {
  it('claims only stale uploads, skipping one completed or re-minted in between', async () => {
    const { id, setId } = await newGallery();
    const stale = photoUpload(id, setId, { now: at(0) });
    const completed = photoUpload(id, setId, { now: at(0) });
    const reminted = photoUpload(id, setId, { now: at(0) });
    const fresh = photoUpload(id, setId, { now: at(60 * 23) });
    for (const p of [stale, completed, reminted, fresh]) await register(p);
    await ready(id, completed.id, at(60 * 25));
    await run(remintPhotoStatement({ ...reminted, now: at(60 * 25) }), opts());
    const now = at(60 * 25);
    expect(await changes(claimStaleUploadsStatement({ now, staleBefore: at(60) }))).toBe(1);
    const purgeable = await listPurgeablePhotos({ galleryId: id, limit: 90 }, opts());
    expect(purgeable).toEqual([{ id: stale.id, gallery_id: id, content_type: 'image/jpeg', rev: stale.rev, derivative_ext: 'webp' }]);
    expect(await changes(deletePhotosStatement([stale.id, completed.id]))).toBe(1);
    expect(await listPurgeablePhotos({ limit: 90 }, opts())).toEqual([]);
  });

  it('uses the purge and order indexes', async () => {
    const plan = async (s: Statement) =>
      (await all<{ detail: string }>(statement(`EXPLAIN QUERY PLAN ${s.sql}`, s.params), opts())).map((r) => r.detail).join(' / ');
    expect(await plan(statement(`SELECT id FROM photos WHERE status IN ('uploading', 'deleted') AND status = 'deleted' ORDER BY updated_at LIMIT 90`))).toMatch(/ix_photos_purge/);
    expect(await plan(claimStaleUploadsStatement({ now: at(0), staleBefore: at(0) }))).toMatch(/ix_photos_purge/);
    expect(
      await plan(statement(`SELECT id FROM photos WHERE set_id = ? AND sort_key > ? AND gallery_id = ? AND status IN ('uploading', 'ready') ORDER BY sort_key LIMIT 200`, ['s', 'a', 'g'])),
    ).toMatch(/ix_photos_set_order/);
  });
});
