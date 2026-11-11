import { statement, type Options } from '@repo/db/client';

export function createAdminSessionStatement(
  session: { id: string; passwordVersion: string; userAgent: string; expiresAt: string },
  opts?: Options,
): D1PreparedStatement {
  return statement(
    'INSERT INTO admin_sessions (id, password_version, user_agent, expires_at) VALUES (?, ?, ?, ?)',
    [session.id, session.passwordVersion, session.userAgent.slice(0, 300), session.expiresAt],
    opts,
  );
}

/** Slide the expiry. Callers do this at most hourly (a write per request would burn the write budget). */
export function touchAdminSessionStatement(id: string, now: string, expiresAt: string, opts?: Options): D1PreparedStatement {
  return statement('UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now, expiresAt, id], opts);
}

export function deleteAdminSessionStatement(id: string, opts?: Options): D1PreparedStatement {
  return statement('DELETE FROM admin_sessions WHERE id = ?', [id], opts);
}

/** "Sign out everywhere". */
export function deleteAllAdminSessionsStatement(opts?: Options): D1PreparedStatement {
  return statement('DELETE FROM admin_sessions', [], opts);
}

/** Housekeeping: drop expired sessions (run after a login, cheap: indexed). */
export function deleteExpiredAdminSessionsStatement(now: string, opts?: Options): D1PreparedStatement {
  return statement('DELETE FROM admin_sessions WHERE expires_at <= ?', [now], opts);
}
