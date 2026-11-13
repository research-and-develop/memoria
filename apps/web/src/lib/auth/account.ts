import 'server-only';

import type { Options } from '@repo/db/client';
import { getPlatform } from '@repo/platform/current';

import { getAdminAccountRow, type AccountSetBy } from '@/lib/db/queries/admin_account';

/**
 * The sign-in account (plan p02b, D2b.2): the `admin_account` row when it
 * exists, else ADMIN_EMAIL / ADMIN_PASSWORD_HASH from env (development and a
 * first install), else none (sign-in answers 503). Once a row exists the env
 * values are ignored; deleting the row brings them back, which is why
 * deployment.md removes them after the first install.
 *
 * No React here: the relay Worker (Phase 3) reads it too. Server components use
 * the cached `getAdminAccount()` (account.cached.ts); a route handler reads it
 * once (`requireAdmin` hands it over as `ctx.account`).
 */
export type AdminAccount = {
  /** Lower-case. */
  email: string;
  /** Trimmed: its fingerprint is every session's `password_version`. */
  passwordHash: string;
  source: 'database' | 'env';
  /** Who chose the password; 'env' for the env account. */
  setBy: AccountSetBy;
};

export async function readAdminAccount(opts?: Options): Promise<AdminAccount | null> {
  const row = await getAdminAccountRow(opts);
  if (row) return { email: row.email.toLowerCase(), passwordHash: row.password_hash.trim(), source: 'database', setBy: row.set_by };
  const { adminEmail, adminPasswordHash } = getPlatform().config().bootstrap;
  const email = adminEmail.trim().toLowerCase();
  const passwordHash = adminPasswordHash.trim();
  if (!email || !passwordHash) return null;
  return { email, passwordHash, source: 'env', setBy: 'env' };
}

/** ADMIN_PASSWORD_HASH is still set on the server (the Sign-in card warns while a database account exists, D2b.2). */
export function envPasswordStillSet(): boolean {
  return getPlatform().config().bootstrap.adminPasswordHash.trim() !== '';
}
