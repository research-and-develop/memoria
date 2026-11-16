import { logger } from '@repo/logger';

import { expireStaleJobs, pruneFinishedJobs } from '@/lib/db/queries/jobs';

import type { JobKind } from './types';

/** A pending job due for longer than this fails EXPIRED (the relay was down). */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Finished jobs are kept this long (Settings → Emails lists them), then deleted. */
export const KEEP_FINISHED_MS = 30 * 24 * 60 * 60 * 1000;
/** Rows deleted per run: bounded writes; a backlog clears over the following days. */
export const PRUNE_LIMIT = 500;

/**
 * The daily housekeeping job (plan p03, D3.10), enqueued by `enqueuePeriodicJobs` once per UTC day.
 * Later phases add steps (the R2 sweep in Phase 5, IP expiry in Phase 11).
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
    if (expired || pruned) logger.info({ event: 'housekeeping', expired, pruned });
  },
};
