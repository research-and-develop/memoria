import { all, first, statement, type Options } from '@repo/db/client';

import {
  ADMIN_AUTHENTICATOR_COLUMNS,
  ADMIN_AUTHENTICATOR_SUMMARY_COLUMNS,
  MAX_AUTHENTICATORS,
  type AdminAuthenticatorRow,
  type AdminAuthenticatorSummary,
} from './types';

/** Every authenticator with its encrypted secret (the code check). Oldest first; at most 10 exist. */
export function listAdminAuthenticators(opts?: Options): Promise<AdminAuthenticatorRow[]> {
  return all<AdminAuthenticatorRow>(
    statement(`SELECT ${ADMIN_AUTHENTICATOR_COLUMNS} FROM admin_authenticators ORDER BY created_at, id LIMIT ?`, [MAX_AUTHENTICATORS]),
    opts,
  );
}

/** For pages: no secrets. */
export function listAdminAuthenticatorSummaries(opts?: Options): Promise<AdminAuthenticatorSummary[]> {
  return all<AdminAuthenticatorSummary>(
    statement(`SELECT ${ADMIN_AUTHENTICATOR_SUMMARY_COLUMNS} FROM admin_authenticators ORDER BY created_at, id LIMIT ?`, [MAX_AUTHENTICATORS]),
    opts,
  );
}

export async function hasAdminAuthenticator(opts?: Options): Promise<boolean> {
  return (await first(statement('SELECT 1 AS one FROM admin_authenticators LIMIT 1'), opts)) !== null;
}
