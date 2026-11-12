import { statement, type Statement } from '@repo/db/client';

/**
 * Count one hit in `bucket`'s window and return the new count — one atomic
 * upsert, so two concurrent requests can never both read "under the limit".
 */
export function hitRateLimitStatement(bucket: string, windowStart: string): Statement {
  return statement(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
    [bucket, windowStart],
  );
}

/** Housekeeping: forget windows that started before `before` (ISO). */
export function deleteOldRateLimitsStatement(before: string): Statement {
  return statement('DELETE FROM rate_limits WHERE window_start < ?', [before]);
}
