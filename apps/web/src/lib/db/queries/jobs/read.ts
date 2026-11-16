import { allRows, firstRow, statement, type Options } from '@repo/db/client';

import { JOB_COLUMNS, toJobRow, type JobDbRow, type JobRow } from './types';

export function getJob(id: string, opts?: Options): Promise<JobRow | null> {
  return firstRow<JobDbRow, JobRow>(statement(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, [id]), toJobRow, opts);
}

/** An email job by id; null for a missing id or another kind. */
export function getEmailJob(id: string, opts?: Options): Promise<JobRow | null> {
  return firstRow<JobDbRow, JobRow>(statement(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? AND kind = 'email'`, [id]), toJobRow, opts);
}

/** The latest emails, newest first (ix_jobs_kind_created_at). */
export function listRecentEmailJobs(limit: number, opts?: Options): Promise<JobRow[]> {
  return allRows<JobDbRow, JobRow>(
    statement(`SELECT ${JOB_COLUMNS} FROM jobs WHERE kind = 'email' ORDER BY created_at DESC, id LIMIT ?`, [Math.max(1, Math.min(limit, 100))]),
    toJobRow,
    opts,
  );
}

/**
 * The oldest email never tried that has been due since before `dueBefore`, or null: the relay is not
 * running (Settings → Emails' banner). One indexed read (ix_jobs_due), bounded.
 */
export async function oldestUnsentEmailDueAt(dueBefore: string, opts?: Options): Promise<string | null> {
  const row = await firstRow<{ run_after: string }, string>(
    statement(
      `SELECT run_after FROM jobs WHERE status = 'pending' AND priority = 0 AND run_after < ? AND kind = 'email' AND attempts = 0 ORDER BY run_after LIMIT 1`,
      [dueBefore],
    ),
    (r) => r.run_after,
    opts,
  );
  return row;
}
