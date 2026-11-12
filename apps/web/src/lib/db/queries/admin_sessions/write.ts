import { statement, type SqlValue, type Statement } from '@repo/db/client';

import type { AdminSessionInput } from './types';

/**
 * The session insert, written only when `when` (SQL with its params) holds as
 * the statement runs: the sign-in batches make it depend on the code's own
 * write (`changes() > 0`, or `EXISTS` a just-inserted row), so a refused code
 * creates no session.
 */
export function createAdminSessionStatement(session: AdminSessionInput, when?: { sql: string; params: readonly SqlValue[] }): Statement {
  const values: SqlValue[] = [
    session.id,
    session.passwordVersion,
    session.secondFactor,
    session.authenticatorId,
    session.userAgent.slice(0, 300),
    session.country,
    session.expiresAt,
  ];
  const insert = 'INSERT INTO admin_sessions (id, password_version, second_factor, authenticator_id, user_agent, country, expires_at)';
  if (!when) return statement(`${insert} VALUES (?, ?, ?, ?, ?, ?, ?)`, values);
  return statement(`${insert} SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${when.sql}`, [...values, ...when.params]);
}

/** Slide the expiry. Callers do this at most hourly (a write per request would burn the write budget). */
export function touchAdminSessionStatement(id: string, now: string, expiresAt: string): Statement {
  return statement('UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now, expiresAt, id]);
}

export function deleteAdminSessionStatement(id: string): Statement {
  return statement('DELETE FROM admin_sessions WHERE id = ?', [id]);
}

/** "Sign out everywhere". */
export function deleteAllAdminSessionsStatement(): Statement {
  return statement('DELETE FROM admin_sessions');
}

/** Housekeeping: drop expired sessions (run after a sign-in, cheap: indexed). */
export function deleteExpiredAdminSessionsStatement(now: string): Statement {
  return statement('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
}
