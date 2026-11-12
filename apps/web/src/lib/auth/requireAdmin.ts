import 'server-only';

import { cookies, headers } from 'next/headers';

import { forbiddenError, unauthorizedError } from '@repo/api/responses';
import { getPlatform } from '@repo/platform/current';

import { isSameOrigin, isSecureRequest, readCookie } from '@/lib/security/request';

import { resolveSession, sessionCookieName, type AdminSession } from './session';

/**
 * The admin gate.
 *
 *   API routes:     const admin = await requireAdmin(req); if (!admin.ok) return admin.response;
 *   Server pages:   const session = await getAdminSession(); if (!session) redirect('/admin/login');
 *
 * `requireAdmin` runs FIRST in every admin route, before the body is read
 * (guard: scripts/guards/admin-routes-require-admin.test.ts). It refuses a
 * state-changing request that is not same-origin (CSRF), then resolves the
 * session cookie.
 *
 * Over HTTPS only the `__Host-` cookie is read, on plain http only the plain
 * name (D2.19): a sibling subdomain cannot plant a cookie we would accept.
 */
export type AdminContext = { sessionId: string; session: AdminSession };

export type RequireAdminResult = { ok: true; ctx: AdminContext } | { ok: false; response: Response };

export function adminPasswordHash(): string {
  return getPlatform().config().admin.passwordHash;
}

export async function requireAdmin(req: Request): Promise<RequireAdminResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req)) {
    return { ok: false, response: forbiddenError({ reason: 'cross_origin' }) };
  }
  const token = readCookie(req.headers, sessionCookieName(isSecureRequest(req.headers, req.url)));
  const session = await resolveSession(token, { passwordHash: adminPasswordHash() });
  if (!session) return { ok: false, response: unauthorizedError() };
  return { ok: true, ctx: { sessionId: session.sessionId, session } };
}

/** For server components (the admin layout): the current session, or null. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName(isSecureRequest(await headers())))?.value;
  return resolveSession(token, { passwordHash: adminPasswordHash() });
}
