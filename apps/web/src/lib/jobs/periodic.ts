import { run, type Options } from '@repo/db/client';

import { periodicJobStatement } from '@/lib/db/queries/jobs';

import { housekeepingJob } from './housekeeping';

/** Housekeeping starts from this UTC hour each day (a quiet time). */
export const HOUSEKEEPING_HOUR_UTC = 3;

/**
 * On each cron tick (plan p03, D3.10): from 03:00 UTC, the day's `housekeeping:<UTC date>` job,
 * inserted only while no job holds that key, so every other tick writes nothing. `at` is the
 * cron's scheduled time (so `/cdn-cgi/local/scheduled?time=` can test it).
 */
export async function enqueuePeriodicJobs(at: Date, opts?: Options): Promise<boolean> {
  if (at.getUTCHours() < HOUSEKEEPING_HOUR_UTC) return false;
  const day = at.toISOString().slice(0, 10);
  const now = at.toISOString();
  const result = await run(
    periodicJobStatement({
      id: crypto.randomUUID(),
      kind: housekeepingJob.kind,
      payload: JSON.stringify({ v: housekeepingJob.version }),
      priority: housekeepingJob.priority,
      maxAttempts: housekeepingJob.maxAttempts,
      runAfter: now,
      dedupeKey: `housekeeping:${day}`,
      now,
    }),
    opts,
  );
  return result.changes > 0;
}
