import 'server-only';

import { batch, run, type Options, type SqlValue, type Statement } from '@repo/db/client';

import {
  createAdminSessionStatement,
  deleteAdminSessionStatement,
  getLiveAdminSession,
  touchAdminSessionStatement,
  type SecondFactor,
} from '@/lib/db/queries/admin_sessions';
import { auditStatement, conditionalAuditStatement } from '@/lib/db/queries/audit_log';

import { randomToken, sha256Hex } from './crypto';

/**
 * Admin sessions: a random 256-bit token in an httpOnly cookie, its SHA-256 in
 * D1. A session exists only after a second factor (lib/auth/secondFactor.ts).
 *
 * - Ends after 14 days without use and at most 90 days after sign-in (D2.10);
 *   `expires_at` is the earlier of the two, refreshed at most hourly.
 * - The cookie is set once with a 90-day max-age: the server enforces both
 *   limits, the browser only forgets it at the hard limit.
 * - Tied to the password version: rotating the password ends every session.
 */
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

/** `__Host-` binds the cookie to this exact origin over HTTPS; plain http (local dev on a LAN IP) drops the prefix. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-memoria_admin' : 'memoria_admin';
}

/** A cookie to set with `res.cookies.set(c.name, c.value, c.options)` (the session's and the challenge's). */
export type CookieSpec = { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number } };

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds = SESSION_MAX_MS / 1000): CookieSpec {
  return { name: sessionCookieName(secure), value: token, options: { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds } };
}

export function clearedSessionCookie(secure: boolean): CookieSpec {
  return sessionCookie('', secure, 0);
}

/** The short fingerprint of the password hash stored with each session and challenge. */
export async function passwordVersion(passwordHash: string): Promise<string> {
  return (await sha256Hex(`pv:${passwordHash}`)).slice(0, 16);
}

/** When a session last used at `lastSeen` and created at `createdAt` ends. */
export function sessionExpiry(createdAt: Date, lastSeen: Date): string {
  return new Date(Math.min(lastSeen.getTime() + SESSION_IDLE_MS, createdAt.getTime() + SESSION_MAX_MS)).toISOString();
}

export type AdminSession = {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  secondFactor: SecondFactor;
  authenticatorId: string | null;
  verifiedUntil: string | null;
};

export type NewSession = {
  token: string;
  id: string;
  expiresAt: string;
  /** The insert, written only when `when` holds (see createAdminSessionStatement). */
  statements(when: { sql: string; params: readonly SqlValue[] }): Statement[];
};

/**
 * A session to create inside a sign-in batch: the token for the cookie, and
 * the insert plus its audit row, both conditional on the code's own write.
 */
export async function prepareSession(input: {
  passwordHash: string;
  userAgent: string;
  secondFactor: SecondFactor;
  authenticatorId: string | null;
  country: string | null;
  now: Date;
}): Promise<NewSession> {
  const token = randomToken();
  const id = await sha256Hex(token);
  const expiresAt = sessionExpiry(input.now, input.now);
  const version = await passwordVersion(input.passwordHash);
  const summary = input.secondFactor === 'authenticator' ? 'Signed in with an authenticator app' : 'Signed in with a recovery code';
  return {
    token,
    id,
    expiresAt,
    statements: (when) => [
      createAdminSessionStatement(
        {
          id,
          passwordVersion: version,
          secondFactor: input.secondFactor,
          authenticatorId: input.authenticatorId,
          userAgent: input.userAgent,
          country: input.country,
          expiresAt,
        },
        when,
      ),
      conditionalAuditStatement({ action: 'login', entity: 'session', entityId: id.slice(0, 12), summary }, 'EXISTS (SELECT 1 FROM admin_sessions WHERE id = ?)', [id]),
    ],
  };
}

/**
 * The live session behind a cookie token, or null. Slides the expiry when the
 * last refresh is over an hour old, never past 90 days after sign-in. A
 * session made under an older password, or older than 90 days, is deleted on sight.
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
  const createdAt = new Date(row.created_at);
  if (row.password_version !== (await passwordVersion(input.passwordHash)) || now.getTime() - createdAt.getTime() >= SESSION_MAX_MS) {
    await run(deleteAdminSessionStatement(id), opts);
    return null;
  }
  let expiresAt = row.expires_at;
  if (now.getTime() - Date.parse(row.last_seen_at) > SESSION_REFRESH_MS) {
    expiresAt = sessionExpiry(createdAt, now);
    await run(touchAdminSessionStatement(id, now.toISOString(), expiresAt), opts);
  }
  return {
    sessionId: id,
    createdAt: row.created_at,
    expiresAt,
    secondFactor: row.second_factor,
    authenticatorId: row.authenticator_id,
    verifiedUntil: row.verified_until,
  };
}

export async function revokeSession(token: string | null | undefined, opts?: Options): Promise<void> {
  if (!token) return;
  const id = await sha256Hex(token);
  await batch(
    [deleteAdminSessionStatement(id), auditStatement({ action: 'logout', entity: 'session', entityId: id.slice(0, 12), summary: 'Signed out' })],
    opts,
  );
}
