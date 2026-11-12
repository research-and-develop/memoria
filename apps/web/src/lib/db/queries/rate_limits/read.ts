import { first, statement, type Options } from '@repo/db/client';

/** The count in `bucket`'s window (0 when nothing was counted). Reads one row by primary key. */
export async function getRateLimitCount(bucket: string, windowStart: string, opts?: Options): Promise<number> {
  const row = await first<{ count: number }>(statement('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?', [bucket, windowStart]), opts);
  return row?.count ?? 0;
}
