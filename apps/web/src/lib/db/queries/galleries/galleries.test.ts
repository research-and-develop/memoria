import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { deleteGallerySetsStatement, insertSetStatement } from '../photo_sets';
import { bulkHideStatement, insertUploadingPhotoStatement, markReadyStatement } from '../photos';
import {
  bumpContentStatement,
  CHANGED,
  changeAccessStatement,
  clearCoverStatement,
  coverDefaultStatement,
  deleteGalleryStatement,
  getGallery,
  getGalleryBySlug,
  getGalleryPasswordSealed,
  insertGallery,
  insertGalleryStatement,
  listGalleries,
  photosChangedAt,
  publishStatement,
  restoreGalleryStatement,
  setCoverStatement,
  softDeleteGalleryStatement,
  unpublishStatement,
  updateGalleryStatement,
} from './index';
import { at, galleryInsert, photoUpload, uuid } from './testFixtures';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

async function newGallery(over: Parameters<typeof galleryInsert>[0] = {}) {
  const input = galleryInsert(over);
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(input), insertSetStatement({ id: setId, galleryId: input.id, name: 'Photos', now: input.now })], opts());
  return { id: input.id, setId, slug: input.slug };
}

const changes = async (s: ReturnType<typeof statement>) => (await run(s, opts())).changes;
const version = async (id: string) => (await getGallery(id, opts()))!.content_version;

describe('galleries: create and read', () => {
  it('reads back what was inserted, without the sealed password', async () => {
    const { id, slug } = await newGallery({ access: 'password', passwordSealed: 'v1:sealed' });
    const row = await getGallery(id, opts());
    expect(row).toMatchObject({ id, slug, title: 'Maria & Jonas', purpose: 'selection', status: 'draft', access: 'password', password_version: 1, content_version: 1, photo_count: 0, settings: { sort: 'filename' } });
    expect(row).not.toHaveProperty('password_sealed');
    expect(await getGalleryPasswordSealed(id, opts())).toBe('v1:sealed');
    expect(await getGalleryBySlug(slug, opts())).toMatchObject({ id });
  });

  it('refuses a taken slug (UNIQUE: the route maps it to 409 SLUG_TAKEN)', async () => {
    await newGallery({ slug: 'maria-jonas-k7x2qpm4rt' });
    await expect(insertGallery(galleryInsert({ slug: 'maria-jonas-k7x2qpm4rt' }), opts())).rejects.toThrow(/UNIQUE/);
  });

  it.each([
    ['a short slug', { slug: 'ab' }],
    ['an upper-case slug', { slug: 'Maria-jonas' }],
    ['a slug ending in a hyphen', { slug: 'maria-' }],
    ['a slug starting with a hyphen', { slug: '-maria' }],
    ['an empty title', { title: '' }],
    ['a 121-character title', { title: 'x'.repeat(121) }],
    ['a bad shoot date', { shootDate: '2026-02-30' }],
    ['a bad purpose', { purpose: 'other' as 'selection' }],
    ['password access without a password', { access: 'password' as const, passwordSealed: null }],
    ['a password on a link gallery', { access: 'link' as const, passwordSealed: 'v1:x' }],
    ['a bad delivery', { delivery: 'cdn' as 'public' }],
    ['settings that are not an object', { settings: [] as unknown as Record<string, unknown> }],
    ['oversized settings', { settings: { welcome: 'x'.repeat(16_400) } }],
  ])('refuses %s', async (_label, over) => {
    await expect(insertGallery(galleryInsert(over), opts())).rejects.toThrow(/CHECK/);
  });

  it('refuses a published status without published_at, and a negative count', async () => {
    const { id } = await newGallery();
    await expect(run(statement(`UPDATE galleries SET status = 'published' WHERE id = ?`, [id]), opts())).rejects.toThrow(/CHECK/);
    await expect(run(statement('UPDATE galleries SET photo_count = -1 WHERE id = ?', [id]), opts())).rejects.toThrow(/CHECK/);
    await expect(run(statement(`UPDATE galleries SET deleted_at = '2026-11-19 10:00' WHERE id = ?`, [id]), opts())).rejects.toThrow(/CHECK/);
  });

  it('lists live galleries newest first, pages by (created_at, id), and the deleted ones apart', async () => {
    const a = await newGallery({ now: at(1) });
    const b = await newGallery({ now: at(2) });
    const c = await newGallery({ now: at(3) });
    await run(softDeleteGalleryStatement({ id: b.id, now: at(4) }), opts());
    const live = await listGalleries({}, opts());
    expect(live.map((g) => g.id)).toEqual([c.id, a.id]);
    const page2 = await listGalleries({ cursor: { createdAt: live[0]!.created_at, id: live[0]!.id }, limit: 1 }, opts());
    expect(page2.map((g) => g.id)).toEqual([a.id]);
    expect((await listGalleries({ deleted: true }, opts())).map((g) => g.id)).toEqual([b.id]);
    expect(await getGalleryBySlug(b.slug, opts())).toBeNull();
  });
});

describe('galleries: guarded writes', () => {
  it('publishes once: first_published_at kept across unpublish and publish', async () => {
    const { id } = await newGallery();
    expect(await changes(publishStatement({ id, now: at(1) }))).toBe(1);
    expect(await changes(publishStatement({ id, now: at(2) }))).toBe(0);
    expect(await changes(unpublishStatement({ id, now: at(3) }))).toBe(1);
    expect(await getGallery(id, opts())).toMatchObject({ status: 'draft', published_at: null, first_published_at: at(1) });
    await run(publishStatement({ id, now: at(4) }), opts());
    expect(await getGallery(id, opts())).toMatchObject({ status: 'published', published_at: at(4), first_published_at: at(1) });
  });

  it('changes access with the password in one statement and bumps password_version', async () => {
    const { id } = await newGallery();
    await run(changeAccessStatement({ id, access: 'password', passwordSealed: 'v1:a', now: at(1) }), opts());
    expect(await getGalleryPasswordSealed(id, opts())).toBe('v1:a');
    await run(changeAccessStatement({ id, access: 'link', passwordSealed: 'v1:ignored', now: at(2) }), opts());
    expect(await getGallery(id, opts())).toMatchObject({ access: 'link', password_version: 3 });
    expect(await getGalleryPasswordSealed(id, opts())).toBeNull();
  });

  it('PATCH merges settings: a field another write changed in between is kept', async () => {
    const { id } = await newGallery({ settings: { sort: 'filename', theme: 'light' } });
    await run(updateGalleryStatement({ id, patch: { settingsPatch: { theme: 'dark' } }, now: at(1) }), opts());
    await run(updateGalleryStatement({ id, patch: { settingsPatch: { accent: 'rose' }, title: 'New', clientName: null }, now: at(2) }), opts());
    expect(await getGallery(id, opts())).toMatchObject({ title: 'New', client_name: null, settings: { sort: 'filename', theme: 'dark', accent: 'rose' } });
  });

  it('soft delete twice changes once; restore works inside the window and not after it', async () => {
    const { id } = await newGallery();
    expect(await changes(softDeleteGalleryStatement({ id, now: at(0) }))).toBe(1);
    expect(await changes(softDeleteGalleryStatement({ id, now: at(1) }))).toBe(0);
    expect(await changes(updateGalleryStatement({ id, patch: { title: 'x' }, now: at(1) }))).toBe(0);
    const day = 24 * 60;
    // 6 days 23 h after: the window start (now − 7 d) is still before deleted_at.
    expect(await changes(restoreGalleryStatement({ id, now: at(7 * day - 60), windowStart: at(-60) }))).toBe(1);
    await run(softDeleteGalleryStatement({ id, now: at(0) }), opts());
    expect(await changes(restoreGalleryStatement({ id, now: at(7 * day), windowStart: at(0) }))).toBe(0);
    expect(await changes(deleteGalleryStatement({ id, purgeBefore: at(-1) }))).toBe(0);
    // Its sets still reference it: no cascade, the purge deletes them first (D5.18).
    await expect(run(deleteGalleryStatement({ id, purgeBefore: at(0) }), opts())).rejects.toThrow(/FOREIGN KEY/);
    const [, gone] = await batch([deleteGallerySetsStatement(id), deleteGalleryStatement({ id, purgeBefore: at(0) })], opts());
    expect(gone!.changes).toBe(1);
  });
});

describe('galleries: content version, counts and cover', () => {
  async function readyPhoto(galleryId: string, setId: string, over: Parameters<typeof photoUpload>[2] = {}) {
    const p = photoUpload(galleryId, setId, over);
    await run(insertUploadingPhotoStatement(p), opts());
    await run(markReadyStatement({ galleryId, id: p.id, batchNow: at(1) }), opts());
    return p.id;
  }

  it('the guarded bump moves once per real change, never on a no-op batch', async () => {
    const { id, setId } = await newGallery();
    const photo = await readyPhoto(id, setId);
    const hide = (batchNow: string) => [
      bulkHideStatement({ galleryId: id, ids: [photo], hidden: true, batchNow }),
      bumpContentStatement({ id, now: batchNow, when: photosChangedAt(id, batchNow) }),
    ];
    await batch(hide(at(5)), opts());
    expect(await version(id)).toBe(2);
    await batch(hide(at(6)), opts()); // already hidden: nothing written, no bump
    expect(await version(id)).toBe(2);
    await batch([publishStatement({ id, now: at(7) }), bumpContentStatement({ id, now: at(7), when: CHANGED })], opts());
    await batch([publishStatement({ id, now: at(8) }), bumpContentStatement({ id, now: at(8), when: CHANGED })], opts());
    expect(await version(id)).toBe(3);
  });

  it('picks the first landscape by set position then sort_key, else a portrait; never replaces a cover', async () => {
    const { id, setId } = await newGallery();
    const portrait = await readyPhoto(id, setId, { width: 4000, height: 6000, nameKey: 'a' });
    await run(coverDefaultStatement(id), opts());
    expect((await getGallery(id, opts()))!.cover_photo_id).toBe(portrait);

    const g2 = await newGallery();
    const second = uuid('5e7');
    await run(insertSetStatement({ id: second, galleryId: g2.id, name: 'Later', now: at(0) }), opts());
    await readyPhoto(g2.id, second, { nameKey: 'a' });
    const wantedLater = await readyPhoto(g2.id, g2.setId, { nameKey: 'z' });
    await readyPhoto(g2.id, g2.setId, { nameKey: 'b', width: 3000, height: 4000 });
    await run(coverDefaultStatement(g2.id), opts());
    expect((await getGallery(g2.id, opts()))!.cover_photo_id).toBe(wantedLater);
    expect(await changes(coverDefaultStatement(g2.id))).toBe(0);
  });

  it('a cover must be a visible ready photo of the gallery; hiding it clears it', async () => {
    const { id, setId } = await newGallery();
    const other = await newGallery();
    const photo = await readyPhoto(id, setId);
    const foreign = await readyPhoto(other.id, other.setId);
    expect(await changes(setCoverStatement({ galleryId: id, photoId: foreign, now: at(2) }))).toBe(0);
    expect(await changes(setCoverStatement({ galleryId: id, photoId: photo, now: at(2) }))).toBe(1);
    await run(bulkHideStatement({ galleryId: id, ids: [photo], hidden: true, batchNow: at(3) }), opts());
    expect(await changes(setCoverStatement({ galleryId: id, photoId: photo, now: at(2) }))).toBe(0);
    expect(await changes(clearCoverStatement(id))).toBe(1);
    expect((await getGallery(id, opts()))!.cover_photo_id).toBeNull();
    expect(await changes(clearCoverStatement(id))).toBe(0);
  });

  it('exposes nothing else of the raw row', async () => {
    const { id } = await newGallery();
    const raw = await first<Record<string, unknown>>(statement('SELECT * FROM galleries WHERE id = ?', [id]), opts());
    const row = (await getGallery(id, opts()))!;
    expect(Object.keys(raw!).filter((k) => !(k in row))).toEqual(['password_sealed']);
  });
});
