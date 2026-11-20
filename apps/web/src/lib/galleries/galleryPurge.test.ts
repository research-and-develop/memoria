import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, batch, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { getPlatform } from '@repo/platform/current';
import { memoryMailer } from '@repo/platform/memory/mailer';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { insertGalleryStatement, restoreGalleryStatement, softDeleteGalleryStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, photoUpload, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { insertUploadingPhotoStatement, markReadyStatement, PURGE_BATCH, type PhotoUpload } from '@/lib/db/queries/photos';
import { jobStatement } from '@/lib/jobs/enqueue';
import { housekeepingJob } from '@/lib/jobs/housekeeping';
import { runDueJobs } from '@/lib/jobs/runner';

import { photoKeys } from './keys';
import { galleryPurgeJobStatement, galleryPurgeRef } from './purge';

/** `gallery.purge` (plan p05, D5.17): only past the 7-day window, row-driven, chained, self-healing. */
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

const DAY = 24 * 60;
const runAt = (minutes: number) => runDueJobs({ mailerFor: () => memoryMailer(), trigger: 'cron', clock: () => new Date(Date.parse(at(minutes))) });
const purgeJobs = () =>
  all<{ status: string; run_after: string; payload: string; last_error: string | null }>(
    statement(`SELECT status, run_after, payload, last_error FROM jobs WHERE kind = 'gallery.purge' ORDER BY created_at, run_after`),
  );
const count = async (table: string, galleryId: string) =>
  (await all<{ n: number }>(statement(`SELECT count(*) AS n FROM ${table} WHERE ${table === 'galleries' ? 'id' : 'gallery_id'} = ?`, [galleryId])))[0]!.n;

async function gallery() {
  const g = galleryInsert();
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) })]);
  return { id: g.id, setId };
}

async function stored(p: PhotoUpload) {
  await run(insertUploadingPhotoStatement(p));
  await run(markReadyStatement({ galleryId: p.galleryId, id: p.id, batchNow: p.now }));
  const keys = photoKeys({ id: p.id, gallery_id: p.galleryId, content_type: p.contentType, rev: p.rev, derivative_ext: p.derivativeExt });
  await getPlatform().blobs('originals').put(keys.original, new Uint8Array([1]), { contentType: p.contentType });
  await getPlatform().blobs('media').put(keys.thumb, new Uint8Array([1]), { contentType: 'image/webp' });
  await getPlatform().blobs('media').put(keys.display, new Uint8Array([1]), { contentType: 'image/webp' });
  return keys;
}

/** Soft-deleted at `deletedAt` (minutes), its purge due at `dueAt`. */
async function deleted(galleryId: string, deletedAt: number, dueAt = deletedAt + 7 * DAY) {
  const now = new Date(Date.parse(at(deletedAt)));
  await batch([
    softDeleteGalleryStatement({ id: galleryId, now: at(deletedAt) }),
    galleryPurgeJobStatement({ galleryId, run: 0, now, runAfter: new Date(Date.parse(at(dueAt))) }),
  ]);
}

describe('gallery.purge', () => {
  it('past the window: the objects, the photos, the sets and the gallery go, and it is audited', async () => {
    const { id, setId } = await gallery();
    const keys = await Promise.all([stored(photoUpload(id, setId, { now: at(1) })), stored(photoUpload(id, setId, { now: at(1) }))]);
    const other = await gallery();
    await stored(photoUpload(other.id, other.setId, { now: at(1) }));
    await deleted(id, 10);

    expect(await runAt(10 + 7 * DAY + 1)).toMatchObject({ done: 1 });
    expect(await count('photos', id)).toBe(0);
    expect(await count('photo_sets', id)).toBe(0);
    expect(await count('galleries', id)).toBe(0);
    for (const k of keys) {
      expect(await getPlatform().blobs('originals').head(k.original)).toBeNull();
      expect(await getPlatform().blobs('media').head(k.thumb)).toBeNull();
    }
    expect(await count('photos', other.id)).toBe(1);
    const audit = await all<{ summary: string }>(statement(`SELECT summary FROM audit_log WHERE entity_id = ? AND action = 'delete'`, [id]));
    expect(audit).toEqual([{ summary: 'Purged a deleted gallery' }]);
  });

  it('run early (clock skew): reschedules itself for deleted_at + 7 days and deletes nothing', async () => {
    const { id, setId } = await gallery();
    await stored(photoUpload(id, setId, { now: at(1) }));
    await deleted(id, 3 * DAY, 3 * DAY);

    expect(await runAt(3 * DAY + 5)).toMatchObject({ done: 1 });
    expect(await count('photos', id)).toBe(1);
    const jobs = await purgeJobs();
    expect(jobs.map((j) => j.status)).toEqual(['done', 'pending']);
    expect(jobs[1]!.run_after).toBe(at(10 * DAY));
  });

  it('a restored gallery is left alone; restore and purge never both succeed', async () => {
    const { id, setId } = await gallery();
    await stored(photoUpload(id, setId, { now: at(1) }));
    await deleted(id, 10, 10);
    // Restore inside the window succeeds…
    expect((await run(restoreGalleryStatement({ id, now: at(20), windowStart: at(20 - 7 * DAY) }))).changes).toBe(1);
    expect(await runAt(10 + 7 * DAY + 1)).toMatchObject({ done: 1 });
    expect(await count('photos', id)).toBe(1);
    expect(await count('galleries', id)).toBe(1);
    // …and after the window it changes nothing.
    await run(softDeleteGalleryStatement({ id, now: at(100) }));
    expect((await run(restoreGalleryStatement({ id, now: at(100 + 8 * DAY), windowStart: at(100 + DAY) }))).changes).toBe(0);
  });

  it('a full page chains the next run; the last run removes the gallery', async () => {
    const { id, setId } = await gallery();
    const photos = Array.from({ length: PURGE_BATCH + 1 }, () => photoUpload(id, setId, { now: at(1) }));
    await batch(photos.map((p) => insertUploadingPhotoStatement(p)));
    await deleted(id, 10, 10);

    const when = 10 + 7 * DAY + 1;
    await runAt(when);
    expect(await count('photos', id)).toBe(1);
    expect((await purgeJobs()).map((j) => [j.status, JSON.parse(j.payload).run])).toEqual([
      ['done', 0],
      ['pending', 1],
    ]);
    await runAt(when + 1);
    expect(await count('galleries', id)).toBe(0);
  });

  it('at most one is alive per gallery (no dedupe key: the condition)', async () => {
    const { id } = await gallery();
    await deleted(id, 10);
    const again = galleryPurgeJobStatement({ galleryId: id, run: 0, now: new Date(Date.parse(at(11))), runAfter: new Date(Date.parse(at(11))) });
    expect((await run(again)).changes).toBe(0);
    expect(await all(statement(`SELECT id FROM jobs WHERE ref = ?`, [galleryPurgeRef(id)]))).toHaveLength(1);
  });

  it('housekeeping enqueues it for a gallery past its window with none alive (a failed purge self-heals)', async () => {
    const { id } = await gallery();
    await run(softDeleteGalleryStatement({ id, now: at(10) }));
    const live = await gallery();
    await run(jobStatement(housekeepingJob, {}, { now: new Date(Date.parse(at(10 + 7 * DAY + 1))) }).statement);
    await runAt(10 + 7 * DAY + 1);
    const jobs = await purgeJobs();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0]!.payload)).toMatchObject({ galleryId: id, run: 0 });
    expect(await count('galleries', live.id)).toBe(1);
  });
});
