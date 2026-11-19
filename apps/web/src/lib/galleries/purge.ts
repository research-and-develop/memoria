import { batch } from '@repo/db/client';
import { getPlatform } from '@repo/platform/current';
import { logger } from '@repo/logger';

import { claimStaleUploadsStatement, deletePhotosStatement, listPurgeablePhotos, PURGE_BATCH } from '@/lib/db/queries/photos';
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
