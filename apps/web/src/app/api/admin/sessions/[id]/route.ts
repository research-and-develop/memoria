import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { noStore } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { signOutSession } from '@/lib/auth/securitySettings';
import { clearedSessionCookie } from '@/lib/auth/session';
import { isSecureRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Session ids are the SHA-256 (hex) of their token. */
const SESSION_ID = /^[0-9a-f]{64}$/;

/**
 * Sign out one device. This device: no code needed (the cookie is cleared).
 * Another device: confirm with a code first (D2.9).
 */
export const DELETE = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!SESSION_ID.test(id)) return notFoundError();
    const current = id === admin.ctx.sessionId;
    if (!current) {
      const confirm = requireRecentSecondFactor(admin.ctx);
      if (confirm) return confirm;
    }
    if (!(await signOutSession(id))) return notFoundError();
    const res = noStore(NextResponse.json({ data: { id, current } }));
    if (current) {
      const cookie = clearedSessionCookie(isSecureRequest(req.headers, req.url));
      res.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return res;
  },
  { route: 'DELETE /api/admin/sessions/[id]' },
);
