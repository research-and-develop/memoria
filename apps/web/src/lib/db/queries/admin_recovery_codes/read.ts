import { first, statement, type Options } from '@repo/db/client';

import type { RecoveryCodeStatus } from './types';

/** At most 10 rows exist, so the count is cheap. */
export async function getRecoveryCodeStatus(opts?: Options): Promise<RecoveryCodeStatus> {
  const row = await first<{ total: number; unused: number | null; unacknowledged: number | null }>(
    statement(
      `SELECT count(*) AS total,
              sum(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS unused,
              sum(CASE WHEN acknowledged_at IS NULL THEN 1 ELSE 0 END) AS unacknowledged
         FROM admin_recovery_codes`,
    ),
    opts,
  );
  const total = row?.total ?? 0;
  return { total, unused: row?.unused ?? 0, acknowledged: total > 0 && (row?.unacknowledged ?? 0) === 0 };
}
