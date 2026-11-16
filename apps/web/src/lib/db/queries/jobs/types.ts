import { readJson } from '@repo/db/rows';

/** Must match ck_jobs_status (migration 0005). */
export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Mirrors `jobs` (plan p03 → Data), the payload parsed. Timestamps are ISO-8601 UTC with ms. */
export type JobRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: 0 | 1;
  attempts: number;
  max_attempts: number;
  /** pending: when it is due; running: when the lease ends. */
  run_after: string;
  ref: string | null;
  dedupe_key: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type JobDbRow = Omit<JobRow, 'payload'> & { payload: string };

export const JOB_COLUMNS =
  'id, kind, payload, status, priority, attempts, max_attempts, run_after, ref, dedupe_key, last_error, created_at, updated_at, finished_at';

export function toJobRow(row: JobDbRow): JobRow {
  return { ...row, payload: readJson<Record<string, unknown>>(row.payload, {}) };
}

/** What a claim returns: enough to run the job and to fence its finishing write. */
export type ClaimedJob = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  /** This attempt's number (1 on the first run): the fence of every finishing write. */
  attempts: number;
  max_attempts: number;
  /** The previous attempt's outcome: `LEASE_EXPIRED` means its runner died. */
  last_error: string | null;
  created_at: string;
};

export type ClaimedJobDbRow = Omit<ClaimedJob, 'payload'> & { payload: string };

export function toClaimedJob(row: ClaimedJobDbRow): ClaimedJob {
  return { ...row, payload: readJson<Record<string, unknown>>(row.payload, {}) };
}

/** A new job. `payload` is the JSON text (lib/jobs/enqueue.ts builds and checks it). */
export type JobInput = {
  id: string;
  kind: string;
  payload: string;
  priority: 0 | 1;
  maxAttempts: number;
  /** ISO time it becomes due. */
  runAfter: string;
  ref?: string | null;
  /** System jobs only (`<kind>:<entity id>:<variant>`): one row per key while it exists. */
  dedupeKey?: string | null;
  /** ISO time: created_at and updated_at. */
  now: string;
};

/** The fence of a finishing write: this job, still running this attempt. */
export type JobFence = { id: string; attempts: number };
