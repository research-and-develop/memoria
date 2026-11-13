import { first, statement, type Options } from '@repo/db/client';

import { ADMIN_ACCOUNT_COLUMNS, type AdminAccountRow } from './types';

/** The account row, or null while the env account is used (D2b.2). */
export function getAdminAccountRow(opts?: Options): Promise<AdminAccountRow | null> {
  return first<AdminAccountRow>(statement(`SELECT ${ADMIN_ACCOUNT_COLUMNS} FROM admin_account WHERE id = 1`), opts);
}
