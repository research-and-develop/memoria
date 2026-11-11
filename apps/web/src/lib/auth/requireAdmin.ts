import 'server-only';

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cookies, headers } from 'next/headers';

import { forbiddenError, unauthorizedError } from '@repo/api/responses';

import { isSameOrigin, isSecureRequest } from '@/lib/security/request';

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
 */
export type AdminContext = { sessionId: string };

export type RequireAdminResult = { ok: true; ctx: AdminContext } | { ok: false; response: Response };

export function adminPasswordHash(): string {
  return getCloudflareContext().env.ADMIN_PASSWORD_HASH?.trim() ?? '';
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function requireAdmin(req: Request): Promise<RequireAdminResult> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req)) {
    return { ok: false, response: forbiddenError({ reason: 'cross_origin' }) };
  }
  const token = readCookie(req, sessionCookieName(isSecureRequest(req))) ?? readCookie(req, sessionCookieName(!isSecureRequest(req)));
  const session = await resolveSession(token, { passwordHash: adminPasswordHash() });
  if (!session) return { ok: false, response: unauthorizedError() };
  return { ok: true, ctx: { sessionId: session.sessionId } };
}

/** For server components (the admin layout): the current session, or null. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const h = await headers();
  const secure = (h.get('x-forwarded-proto') ?? '').startsWith('https');
  const token = jar.get(sessionCookieName(secure))?.value ?? jar.get(sessionCookieName(!secure))?.value;
  return resolveSession(token, { passwordHash: adminPasswordHash() });
}
