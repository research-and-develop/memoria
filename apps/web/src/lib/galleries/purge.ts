import { batch } from '@repo/db/client';
import { getPlatform } from '@repo/platform/current';
import { logger } from '@repo/logger';

import { isUuid } from '@repo/core/validation';

import { conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { deleteGalleryStatement, getGallery } from '@/lib/db/queries/galleries';
import { deletePurgedGallerySetsStatement } from '@/lib/db/queries/photo_sets';
import {
  claimStaleUploadsStatement,
  deletePhotosStatement,
  deletePurgedGalleryPhotosStatement,
  listGalleryPhotosForPurge,
  listPurgeablePhotos,
  PURGE_BATCH,
} from '@/lib/db/queries/photos';
import { jobStatement, type JobCondition } from '@/lib/jobs/enqueue';
import type { JobKind } from '@/lib/jobs/types';

import { photoKeys } from './keys';
import { PHOTO_DEPENDENT_DELETES } from './photoDependents';

/**
 * The purge jobs (plan p05 → Jobs, D5.17), run by the relay. RELAY-SAFE: query modules, `keys.ts`,
 * `photoDependents.ts` and the job helpers only (guard `relay-graph`). Row-driven: keys are derived
 * from rows, never from a bucket listing (no Class A `list` operations).
 */

/** An upload left `uploading` this long is abandoned (its PUT URLs expired after 10 minutes). */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** "No media.purge is waiting": at most one pending at a time, without a dedupe key (D5.17). */
export function noPendingMediaPurge(excludeJobId?: string): JobCondition {
  return excludeJobId
    ? { sql: `NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'media.purge' AND status = 'pending' AND id != ?)`, params: [excludeJobId] }
    : { sql: `NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'media.purge' AND status = 'pending')`, params: [] };
}

/**
 * `media.purge`: claims ≤ 90 stale uploads, then removes ≤ 90 deleted photos — their objects in both
 * buckets first, then their dependents and rows in one batch. When it found a full 90 it enqueues the
 * next run in that batch (the cron picks it up within a minute; no nudge).
 */
export const mediaPurgeJob: JobKind<Record<string, never>> = {
  kind: 'media.purge',
  version: 1,
  maxAttempts: 5,
  priority: 1,
  backoff: [5, 30, 120],
  parse: () => ({ ok: true, value: {} }),
  async run(_payload, ctx) {
    const now = ctx.now.toISOString();
    await batch([claimStaleUploadsStatement({ now, staleBefore: new Date(ctx.now.getTime() - STALE_UPLOAD_MS).toISOString() })]);
    const photos = await listPurgeablePhotos({ limit: PURGE_BATCH });
    if (photos.length === 0) {
      logger.info({ event: 'purge_run', kind: 'media.purge', deleted: 0, more: false });
      return;
    }
    const keys = photos.map(photoKeys);
    const platform = getPlatform();
    await platform.blobs('originals').delete(keys.map((k) => k.original));
    await platform.blobs('media').delete(keys.flatMap((k) => [k.thumb, k.display]));
    const ids = photos.map((p) => p.id);
    const more = photos.length === PURGE_BATCH;
    await batch([
      ...PHOTO_DEPENDENT_DELETES.map((build) => build(ids)),
      deletePhotosStatement(ids),
      ...(more ? [jobStatement(mediaPurgeJob, {}, { now: ctx.now, when: noPendingMediaPurge(ctx.jobId) }).statement] : []),
    ]);
    logger.info({ event: 'purge_run', kind: 'media.purge', deleted: photos.length, more });
  },
};

/** The job a photo delete enqueues in its batch: `media.purge`, unless one is already pending. */
export function mediaPurgeJobStatement(now: Date) {
  return jobStatement(mediaPurgeJob, {}, { now, when: noPendingMediaPurge() }).statement;
}

/**
 * Housekeeping's step (daily): enqueue `media.purge` when there is something to purge — a deleted
 * photo, or an upload stale for 24 hours (both through ix_photos_purge) — and none is pending.
 */
export function mediaPurgeIfNeededStatement(now: Date) {
  const staleBefore = new Date(now.getTime() - STALE_UPLOAD_MS).toISOString();
  const pending = noPendingMediaPurge();
  return jobStatement(
    mediaPurgeJob,
    {},
    {
      now,
      when: {
        sql: `${pending.sql} AND EXISTS (SELECT 1 FROM photos WHERE status IN ('uploading', 'deleted') AND (status = 'deleted' OR updated_at < ?))`,
        params: [staleBefore],
      },
    },
  ).statement;
}

/** A soft-deleted gallery can be restored for this long; then `gallery.purge` removes it (D5.17). */
export const GALLERY_PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const galleryPurgeRef = (galleryId: string) => `gallery:${galleryId}`;

/** "No gallery.purge is alive for this gallery" (pending or running; `excludeJobId` = the running one itself). */
export function noLiveGalleryPurge(galleryId: string, excludeJobId?: string): JobCondition {
  const base = `NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'gallery.purge' AND ref = ? AND status IN ('pending', 'running')`;
  return excludeJobId
    ? { sql: `${base} AND id != ?)`, params: [galleryPurgeRef(galleryId), excludeJobId] }
    : { sql: `${base})`, params: [galleryPurgeRef(galleryId)] };
}

type GalleryPurgePayload = { galleryId: string; run: number };

/**
 * Every enqueue of `gallery.purge` (D5.17): conditional on none being alive for the gallery (and on
 * `extra`, e.g. "the soft delete in this batch happened"), no dedupe key, `ref = gallery:<id>`.
 */
export function galleryPurgeJobStatement(input: {
  galleryId: string;
  run: number;
  now: Date;
  runAfter: Date;
  excludeJobId?: string;
  extra?: JobCondition;
}) {
  const alive = noLiveGalleryPurge(input.galleryId, input.excludeJobId);
  const when: JobCondition = input.extra ? { sql: `${alive.sql} AND ${input.extra.sql}`, params: [...alive.params, ...input.extra.params] } : alive;
  const payload: GalleryPurgePayload = { galleryId: input.galleryId, run: input.run };
  return jobStatement(galleryPurgeJob, payload, { now: input.now, runAfter: input.runAfter, ref: galleryPurgeRef(input.galleryId), when }).statement;
}

/**
 * `gallery.purge` (D5.17): a gallery gone or restored → nothing to do; still inside its window (clock
 * skew, an early run) → re-enqueued for `deleted_at + 7 d`; else ≤ 90 of its photos (any status): their
 * objects, then dependents and rows in one batch whose every statement repeats "deleted, window passed".
 * A full page chains the next run; the last one deletes the sets and the gallery and audits it.
 */
export const galleryPurgeJob: JobKind<GalleryPurgePayload> = {
  kind: 'gallery.purge',
  version: 1,
  maxAttempts: 5,
  priority: 1,
  backoff: [5, 30, 120],
  parse(payload) {
    const { galleryId, run } = payload as { galleryId?: unknown; run?: unknown };
    return isUuid(galleryId) && typeof run === 'number' && Number.isInteger(run) && run >= 0
      ? { ok: true, value: { galleryId, run } }
      : { ok: false, unknown: false };
  },
  async run({ galleryId, run }, ctx) {
    const gallery = await getGallery(galleryId);
    if (!gallery || !gallery.deleted_at) {
      logger.info({ event: 'purge_run', kind: 'gallery.purge', galleryId, deleted: 0, more: false, skipped: gallery ? 'restored' : 'gone' });
      return;
    }
    const purgeBefore = new Date(ctx.now.getTime() - GALLERY_PURGE_AFTER_MS).toISOString();
    if (gallery.deleted_at > purgeBefore) {
      const runAfter = new Date(Date.parse(gallery.deleted_at) + GALLERY_PURGE_AFTER_MS);
      await batch([galleryPurgeJobStatement({ galleryId, run, now: ctx.now, runAfter, excludeJobId: ctx.jobId })]);
      logger.info({ event: 'purge_run', kind: 'gallery.purge', galleryId, deleted: 0, more: true, rescheduled: runAfter.toISOString() });
      return;
    }
    const photos = await listGalleryPhotosForPurge({ galleryId, limit: PURGE_BATCH });
    if (photos.length > 0) {
      const keys = photos.map(photoKeys);
      const platform = getPlatform();
      await platform.blobs('originals').delete(keys.map((k) => k.original));
      await platform.blobs('media').delete(keys.flatMap((k) => [k.thumb, k.display]));
    }
    const ids = photos.map((p) => p.id);
    const rows = ids.length > 0 ? [...PHOTO_DEPENDENT_DELETES.map((build) => build(ids)), deletePurgedGalleryPhotosStatement({ galleryId, ids, purgeBefore })] : [];
    const more = photos.length === PURGE_BATCH;
    if (more) {
      await batch([...rows, galleryPurgeJobStatement({ galleryId, run: run + 1, now: ctx.now, runAfter: ctx.now, excludeJobId: ctx.jobId })]);
    } else {
      await batch([
        ...rows,
        deletePurgedGallerySetsStatement({ galleryId, purgeBefore }),
        deleteGalleryStatement({ id: galleryId, purgeBefore }),
        conditionalAuditStatement(
          { action: 'delete', entity: 'galleries', entityId: galleryId, summary: 'Purged a deleted gallery', details: { event: 'purged', runs: run + 1 } },
          'changes() > 0',
          [],
        ),
      ]);
    }
    logger.info({ event: 'purge_run', kind: 'gallery.purge', galleryId, deleted: photos.length, more });
  },
};

/**
 * Housekeeping's sweep (daily): `gallery.purge` for the galleries past their window that have none
 * alive (a purge that failed its last attempt self-heals the next day).
 */
export function galleryPurgeSweepStatements(galleryIds: readonly string[], now: Date) {
  return galleryIds.map((galleryId) => galleryPurgeJobStatement({ galleryId, run: 0, now, runAfter: now }));
}
