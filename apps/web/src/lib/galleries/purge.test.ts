import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, batch, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { getPlatform } from '@repo/platform/current';
import { memoryMailer } from '@repo/platform/memory/mailer';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { insertGalleryStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, photoUpload, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { bulkDeleteStatement, insertUploadingPhotoStatement, markReadyStatement, PURGE_BATCH, type PhotoUpload } from '@/lib/db/queries/photos';
import { housekeepingJob } from '@/lib/jobs/housekeeping';
import { jobStatement } from '@/lib/jobs/enqueue';
import { runDueJobs } from '@/lib/jobs/runner';

import { photoKeys } from './keys';
import { mediaPurgeIfNeededStatement, mediaPurgeJob } from './purge';

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
const NOW = new Date(Date.parse(at(3 * DAY)));
const runJobs = () => runDueJobs({ mailerFor: () => memoryMailer(), trigger: 'cron', clock: () => NOW });
const jobs = () => all<{ kind: string; status: string }>(statement('SELECT kind, status FROM jobs ORDER BY created_at, kind'));
const photoIds = async () => (await all<{ id: string }>(statement('SELECT id FROM photos ORDER BY id'))).map((r) => r.id);

async function gallery() {
  const g = galleryInsert();
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) })]);
  return { id: g.id, setId };
}

/** A photo with its three objects stored. */
async function stored(p: PhotoUpload, ready: boolean) {
  await run(insertUploadingPhotoStatement(p));
  if (ready) await run(markReadyStatement({ galleryId: p.galleryId, id: p.id, batchNow: p.now }));
  const keys = photoKeys({ id: p.id, gallery_id: p.galleryId, content_type: p.contentType, rev: p.rev, derivative_ext: p.derivativeExt });
  await getPlatform().blobs('originals').put(keys.original, new Uint8Array([1]), { contentType: p.contentType });
  await getPlatform().blobs('media').put(keys.thumb, new Uint8Array([1]), { contentType: 'image/webp' });
  await getPlatform().blobs('media').put(keys.display, new Uint8Array([1]), { contentType: 'image/webp' });
  return keys;
}

const enqueuePurge = () => run(jobStatement(mediaPurgeJob, {}, { now: NOW }).statement);

describe('media.purge', () => {
  it('removes deleted photos and stale uploads (objects in both buckets, then rows); keeps ready and fresh ones', async () => {
    const { id, setId } = await gallery();
    const keep = photoUpload(id, setId, { now: at(3 * DAY - 10) });
    const fresh = photoUpload(id, setId, { now: at(3 * DAY - 60) });
    const stale = photoUpload(id, setId, { now: at(0) });
    const deleted = photoUpload(id, setId, { now: at(DAY) });
    const keepKeys = await stored(keep, true);
    await stored(fresh, false);
    const staleKeys = await stored(stale, false);
    const deletedKeys = await stored(deleted, true);
    await run(bulkDeleteStatement({ galleryId: id, ids: [deleted.id], batchNow: at(2 * DAY) }));

    await enqueuePurge();
    expect(await runJobs()).toMatchObject({ done: 1 });
    expect(await photoIds()).toEqual([keep.id, fresh.id].sort());
    for (const k of [staleKeys, deletedKeys]) {
      expect(await getPlatform().blobs('originals').head(k.original)).toBeNull();
      expect(await getPlatform().blobs('media').head(k.display)).toBeNull();
    }
    expect(await getPlatform().blobs('originals').head(keepKeys.original)).not.toBeNull();
  });

  it('chains a next run when it found a full batch, and never two pending', async () => {
    const { id, setId } = await gallery();
    const many = Array.from({ length: PURGE_BATCH + 1 }, () => photoUpload(id, setId, { now: at(0) }));
    await batch(many.map((p) => insertUploadingPhotoStatement(p)));
    await enqueuePurge();
    await runJobs();
    // 90 claimed and removed in the first run; the 91st waits for the chained run.
    expect(await photoIds()).toHaveLength(1);
    expect((await jobs()).filter((j) => j.kind === 'media.purge' && j.status === 'pending')).toHaveLength(1);
    await run(mediaPurgeIfNeededStatement(NOW));
    expect((await jobs()).filter((j) => j.kind === 'media.purge' && j.status === 'pending')).toHaveLength(1);
    await runJobs();
    expect(await photoIds()).toEqual([]);
  });
});

describe('housekeeping → media.purge', () => {
  it('enqueues a purge only when something waits and none is pending', async () => {
    const { id, setId } = await gallery();
    await run(mediaPurgeIfNeededStatement(NOW));
    expect(await jobs()).toEqual([]);
    await stored(photoUpload(id, setId, { now: at(0) }), false);
    await run(jobStatement(housekeepingJob, {}, { now: NOW }).statement);
    await runJobs();
    expect(await jobs()).toEqual(expect.arrayContaining([{ kind: 'housekeeping', status: 'done' }, { kind: 'media.purge', status: 'pending' }]));
  });
});
