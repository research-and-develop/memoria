import { statement, type Statement } from '@repo/db/client';

import type { AdminAccountInput } from './types';

/**
 * Save the account (plan p02b → Data). An existing row changes only while its
 * hash is still `expectedHash`, the one the current password was checked
 * against: a concurrent change or a CLI reset wins, and `changes` is 0. With no
 * row yet (the env account) it inserts: the env hash cannot change while the
 * Worker runs. The email is stored lower-cased, the hash trimmed.
 */
export function saveAdminAccountStatement(input: AdminAccountInput): Statement {
  return statement(
    `INSERT INTO admin_account (id, email, password_hash, set_by, updated_at) VALUES (1, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash,
    set_by = excluded.set_by, updated_at = excluded.updated_at
  WHERE admin_account.password_hash = ?`,
    [input.email.trim().toLowerCase(), input.passwordHash.trim(), input.setBy, input.now, input.expectedHash.trim()],
  );
}

/** The condition "the account now holds `passwordHash`", for the statements that follow a save in its batch. */
export function accountHoldsHashCondition(passwordHash: string): { sql: string; params: [string] } {
  return { sql: 'EXISTS (SELECT 1 FROM admin_account WHERE id = 1 AND password_hash = ?)', params: [passwordHash.trim()] };
}

/**
 * After a new password: every session and sign-in challenge ends (they carry
 * the old password's version, so they are dead anyway; this removes them).
 * Only when the save in the same batch took effect.
 */
export function endSignInsAfterPasswordStatements(newHash: string): Statement[] {
  const when = accountHoldsHashCondition(newHash);
  return [
    statement(`DELETE FROM admin_mfa_challenges WHERE ${when.sql}`, when.params),
    statement(`DELETE FROM admin_sessions WHERE ${when.sql}`, when.params),
  ];
}
