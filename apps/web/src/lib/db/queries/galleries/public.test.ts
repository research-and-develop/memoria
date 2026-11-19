import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { all, batch, run, statement, type Statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { publicSetsStatement, type PublicSetRow } from '../photo_sets/public';
import { insertSetStatement } from '../photo_sets';
import { bulkDeleteStatement, bulkHideStatement, insertUploadingPhotoStatement, markReadyStatement } from '../photos';
import { PUBLIC_PHOTO_PAGE, publicPhotosStatement, type PublicPhotoRow } from '../photos/public';
import { insertGalleryStatement, setCoverStatement, softDeleteGalleryStatement } from './index';
import { galleryBySlugStatement, toPublicGalleryRow, type PublicGalleryDbRow } from './public';
import { at, galleryInsert, photoUpload, PLACEHOLDER, uuid } from './testFixtures';
import type { GalleryInsert } from './types';

/**
 * The edge-safe public reads of galleries, photo_sets and photos (plan p06 D6.6, D6.8), together: they
 * are what one gallery view runs. `worker.ts` runs them on the `Db` port, so the tests do too.
 */
let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

async function newGallery(over: Partial<GalleryInsert> = {}) {
  const g = galleryInsert(over);
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) })], opts());
  return { ...g, setId };
}

async function readyPhoto(galleryId: string, setId: string, nameKey: string) {
  const p = photoUpload(galleryId, setId, { nameKey });
  await batch([insertUploadingPhotoStatement(p), markReadyStatement({ galleryId, id: p.id, batchNow: at(1) })], opts());
  return p.id;
}

const gallery = async (slug: string) => {
  const row = await testDb.db.first<PublicGalleryDbRow>(galleryBySlugStatement(slug));
  return row ? toPublicGalleryRow(row) : null;
};
const photos = (s: Statement) => testDb.db.all<PublicPhotoRow>(s);
const deepKeys = (value: unknown): string[] =>
  value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...deepKeys(v)]) : [];

describe('galleryBySlugStatement', () => {
  it('reads what a client may see, never the password or the client', async () => {
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed-secret', settings: { sort: 'taken', theme: 'dark' } });
    const row = await gallery(g.slug);
    expect(row).toEqual({
      id: g.id,
      slug: g.slug,
      title: g.title,
      shoot_date: g.shootDate,
      purpose: 'selection',
      status: 'draft',
      access: 'password',
      password_version: 1,
      delivery: 'public',
      settings: { sort: 'taken', theme: 'dark' },
      content_version: 1,
      cover: null,
    });
    const keys = deepKeys(row);
    for (const banned of ['password_sealed', 'client_name', 'client_email', 'filename']) expect(keys).not.toContain(banned);
    expect(JSON.stringify(row)).not.toMatch(/sealed-secret|maria@example\.com/);
  });

  it('does not find an unknown or a deleted gallery', async () => {
    const g = await newGallery();
    expect(await gallery('no-such-gallery')).toBeNull();
    await run(softDeleteGalleryStatement({ id: g.id, now: at(2) }), opts());
    expect(await gallery(g.slug)).toBeNull();
  });

  it('carries the cover while it is a ready, visible photo', async () => {
    const g = await newGallery();
    const photoId = await readyPhoto(g.id, g.setId, 'a');
    await run(setCoverStatement({ galleryId: g.id, photoId, now: at(2) }), opts());
    expect((await gallery(g.slug))?.cover).toEqual({ id: photoId, w: 1600, h: 1067, color: PLACEHOLDER, rev: 'abcd2345', ext: 'webp' });
    await run(bulkHideStatement({ galleryId: g.id, ids: [photoId], hidden: true, batchNow: at(3) }), opts());
    expect((await gallery(g.slug))?.cover).toBeNull();
  });
});

describe('publicSetsStatement', () => {
  it("lists this gallery's sets in their order, not another's", async () => {
    const g = await newGallery();
    const other = await newGallery();
    const second = uuid('5e7');
    await run(insertSetStatement({ id: second, galleryId: g.id, name: 'Ceremony', now: at(1) }), opts());
    const sets = await testDb.db.all<PublicSetRow>(publicSetsStatement(g.id));
    expect(sets).toEqual([
      { id: g.setId, name: 'Photos', photo_count: 0 },
      { id: second, name: 'Ceremony', photo_count: 0 },
    ]);
    expect(sets.map((s) => s.id)).not.toContain(other.setId);
  });
});

describe('publicPhotosStatement', () => {
  it('pages the ready, visible photos in sort_key order', async () => {
    const g = await newGallery();
    const [a, b, c, hidden, deleted] = [
      await readyPhoto(g.id, g.setId, 'a'),
      await readyPhoto(g.id, g.setId, 'b'),
      await readyPhoto(g.id, g.setId, 'c'),
      await readyPhoto(g.id, g.setId, 'd'),
      await readyPhoto(g.id, g.setId, 'e'),
    ];
    await batch(
      [
        bulkHideStatement({ galleryId: g.id, ids: [hidden!], hidden: true, batchNow: at(2) }),
        bulkDeleteStatement({ galleryId: g.id, ids: [deleted!], batchNow: at(2) }),
      ],
      opts(),
    );
    const uploading = photoUpload(g.id, g.setId, { nameKey: '0' });
    await run(insertUploadingPhotoStatement(uploading), opts());

    const first = await photos(publicPhotosStatement(g.id, g.setId, '', 2));
    expect(first.map((p) => p.id)).toEqual([a, b]);
    expect(first[0]).toEqual({ id: a, w: 1600, h: 1067, color: PLACEHOLDER, rev: 'abcd2345', ext: 'webp', sort_key: expect.any(String) });
    const rest = await photos(publicPhotosStatement(g.id, g.setId, first[1]!.sort_key));
    expect(rest.map((p) => p.id)).toEqual([c]);
  });

  it("returns nothing for a set of another gallery (the join), even when it exists", async () => {
    const g = await newGallery();
    const other = await newGallery();
    await readyPhoto(other.id, other.setId, 'a');
    expect(await photos(publicPhotosStatement(g.id, other.setId, ''))).toEqual([]);
    expect(await photos(publicPhotosStatement(other.id, other.setId, ''))).toHaveLength(1);
  });

  it.each([
    [0, 1],
    [10, 10],
    [10_000, PUBLIC_PHOTO_PAGE + 1],
  ])('bounds a limit of %i to %i', (limit, bound) => {
    expect(publicPhotosStatement('g', 's', '', limit).params.at(-1)).toBe(bound);
  });

  it('reads through ix_photos_set_order', async () => {
    const s = publicPhotosStatement('g', 's', '');
    const plan = await all<{ detail: string }>(statement(`EXPLAIN QUERY PLAN ${s.sql}`, s.params), opts());
    expect(plan.map((r) => r.detail).join(' / ')).toMatch(/ix_photos_set_order/);
  });
});
