import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { batch } from '@repo/db/client';

import { requireAdmin } from '@/lib/auth/requireAdmin';
import { clearedSessionCookie, revokeSession, sessionCookieName } from '@/lib/auth/session';
import { auditStatement } from '@/lib/db/queries/audit_log';
import { deleteAllAdminSessionsStatement } from '@/lib/db/queries/admin_sessions';
import { isSameOrigin, isSecureRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign out. `{ everywhere: true }` ends EVERY session (a
 * lost phone, a shared computer) and needs a valid session; a plain logout
 * works even with an expired one and always clears the cookie.
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    if (!isSameOrigin(req)) return forbiddenError({ reason: 'cross_origin' });
    const body = (await req.json().catch(() => ({}))) as { everywhere?: unknown };
    const secure = isSecureRequest(req.headers, req.url);

    if (body.everywhere === true) {
      const admin = await requireAdmin(req);
      if (!admin.ok) return admin.response;
      await batch([
        deleteAllAdminSessionsStatement(),
        auditStatement({ action: 'logout', entity: 'session', summary: 'Signed out everywhere' }),
      ]);
    } else {
      await revokeSession(req.cookies.get(sessionCookieName(secure))?.value);
    }

    const cookie = clearedSessionCookie(secure);
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  },
  { route: 'POST /api/admin/logout' },
);
