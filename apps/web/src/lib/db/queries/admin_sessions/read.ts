import { all, first, statement, type Options } from '@repo/db/client';

import { ADMIN_SESSION_COLUMNS, type AdminSessionRow } from './types';

/** A session that has not expired at `now` (ISO). */
export function getLiveAdminSession(id: string, now: string, opts?: Options): Promise<AdminSessionRow | null> {
  return first<AdminSessionRow>(statement(`SELECT ${ADMIN_SESSION_COLUMNS} FROM admin_sessions WHERE id = ? AND expires_at > ?`, [id, now]), opts);
}

/** Every live session, newest activity first (an admin "sessions" panel). */
export function listLiveAdminSessions(now: string, opts?: Options): Promise<AdminSessionRow[]> {
  return all<AdminSessionRow>(
    statement(`SELECT ${ADMIN_SESSION_COLUMNS} FROM admin_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC LIMIT 50`, [now]),
    opts,
  );
}
