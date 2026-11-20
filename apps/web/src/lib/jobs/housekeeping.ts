import { batch } from '@repo/db/client';
import { logger } from '@repo/logger';

import { listPurgeDueGalleries } from '@/lib/db/queries/galleries';
import { expireStaleJobs, pruneFinishedJobs } from '@/lib/db/queries/jobs';
import { GALLERY_PURGE_AFTER_MS, galleryPurgeSweepStatements, mediaPurgeIfNeededStatement } from '@/lib/galleries/purge';

import type { JobKind } from './types';

/** A pending job due for longer than this fails EXPIRED (the relay was down). */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Finished jobs are kept this long (Settings → Emails lists them), then deleted. */
export const KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;
/** Rows deleted per run: bounded writes; a backlog clears over the following days. */
export const PRUNE_LIMIT = 500;
/** Galleries past their purge window given a `gallery.purge` per run (D5.17). */
export const GALLERY_SWEEP_LIMIT = 10;

/**
 * The daily housekeeping job (plan p03, D3.10), enqueued by `enqueuePeriodicJobs` once per UTC day.
 * Later phases add steps: Phase 5 enqueues `media.purge` when photos wait to be purged and `gallery.purge`
 * for deleted galleries past their window; IP expiry in Phase 11.
 */
export const housekeepingJob: JobKind<Record<string, never>> = {
  kind: 'housekeeping',
  version: 1,
  maxAttempts: 3,
  priority: 1,
  backoff: [5, 30],
  parse: () => ({ ok: true, value: {} }),
  async run(_payload, ctx) {
    const now = ctx.now.getTime();
    const expired = await expireStaleJobs({ before: new Date(now - STALE_AFTER_MS).toISOString(), now: ctx.now.toISOString() });
    const pruned = await pruneFinishedJobs({ before: new Date(now - KEEP_FINISHED_MS).toISOString(), limit: PRUNE_LIMIT });
    const due = await listPurgeDueGalleries({ purgeBefore: new Date(now - GALLERY_PURGE_AFTER_MS).toISOString(), limit: GALLERY_SWEEP_LIMIT });
    const [purge, ...sweep] = await batch([mediaPurgeIfNeededStatement(ctx.now), ...galleryPurgeSweepStatements(due, ctx.now)]);
    const mediaPurge = (purge?.changes ?? 0) > 0;
    const galleryPurges = sweep.filter((r) => r.changes > 0).length;
    if (expired || pruned || mediaPurge || galleryPurges) logger.info({ event: 'housekeeping', expired, pruned, mediaPurge, galleryPurges });
  },
};
