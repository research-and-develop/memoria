import 'server-only';

import { batch, type Options } from '@repo/db/client';

import {
  createAdminSessionStatement,
  deleteAdminSessionStatement,
  deleteExpiredAdminSessionsStatement,
  getLiveAdminSession,
  touchAdminSessionStatement,
} from '@/lib/db/queries/admin_sessions';
import { auditStatement } from '@/lib/db/queries/audit_log';

import { randomToken, sha256Hex } from './crypto';

/**
 * Admin sessions: a random 256-bit token in an httpOnly cookie,
 * its SHA-256 in D1. 14-day sliding expiry, refreshed at most hourly.
 * Tied to the password version: rotating the password ends every session.
 */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

/** `__Host-` binds the cookie to this exact origin over HTTPS; plain http (local dev on a LAN IP) drops the prefix. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-memoria_admin' : 'memoria_admin';
}

export type SessionCookie = { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number } };

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_TTL_MS / 1000): SessionCookie {
  return { name: sessionCookieName(secure), value: token, options: { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds } };
}

export function clearedSessionCookie(secure: boolean): SessionCookie {
  return sessionCookie('', secure, 0);
}

/** The short fingerprint of the password hash stored with each session. */
export async function passwordVersion(passwordHash: string): Promise<string> {
  return (await sha256Hex(`pv:${passwordHash}`)).slice(0, 16);
}

export type AdminSession = { sessionId: string; createdAt: string; expiresAt: string };

/** Create a session (and record the login) in one batch; returns the cookie token. */
export async function createSession(
  input: { passwordHash: string; userAgent: string; now?: Date },
  opts?: Options,
): Promise<{ token: string; session: AdminSession }> {
  const now = input.now ?? new Date();
  const token = randomToken();
  const id = await sha256Hex(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await batch(
    [
      deleteExpiredAdminSessionsStatement(now.toISOString(), opts),
      createAdminSessionStatement({ id, passwordVersion: await passwordVersion(input.passwordHash), userAgent: input.userAgent, expiresAt }, opts),
      auditStatement({ action: 'login', entity: 'session', entityId: id.slice(0, 12), summary: 'Signed in' }, opts),
    ],
    opts,
  );
  return { token, session: { sessionId: id, createdAt: now.toISOString(), expiresAt } };
}

/**
 * The live session behind a cookie token, or null. Slides the expiry when the
 * last refresh is over an hour old. A session made under an older password is
 * deleted on sight.
 */
export async function resolveSession(
  token: string | null | undefined,
  input: { passwordHash: string; now?: Date },
  opts?: Options,
): Promise<AdminSession | null> {
  if (!token || token.length < 20 || token.length > 100 || !input.passwordHash) return null;
  const now = input.now ?? new Date();
  const id = await sha256Hex(token);
  const row = await getLiveAdminSession(id, now.toISOString(), opts);
  if (!row) return null;
  if (row.password_version !== (await passwordVersion(input.passwordHash))) {
    await deleteAdminSessionStatement(id, opts).run();
    return null;
  }
  let expiresAt = row.expires_at;
  if (now.getTime() - Date.parse(row.last_seen_at) > SESSION_REFRESH_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    await touchAdminSessionStatement(id, now.toISOString(), expiresAt, opts).run();
  }
  return { sessionId: id, createdAt: row.created_at, expiresAt };
}

export async function revokeSession(token: string | null | undefined, opts?: Options): Promise<void> {
  if (!token) return;
  const id = await sha256Hex(token);
  await batch(
    [deleteAdminSessionStatement(id, opts), auditStatement({ action: 'logout', entity: 'session', entityId: id.slice(0, 12), summary: 'Signed out' }, opts)],
    opts,
  );
}
