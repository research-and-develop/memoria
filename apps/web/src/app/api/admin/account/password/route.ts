import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { accountChanged, changeAccountPassword, checkCurrentPassword } from '@/lib/auth/accountChange';
import { noStore } from '@/lib/auth/codeStep';
import { parsePasswordChange } from '@/lib/auth/parseAccountInput';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { clearedSessionCookie } from '@/lib/auth/session';
import { isSecureRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change the sign-in password (plan p02b): rate limits → a recent code → the
 * current password (lib/auth/accountChange.ts). Every session and sign-in
 * ends, this one too (D2b.6): the cookie is cleared and the page goes to sign-in.
 */
export const PATCH = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const parsed = parsePasswordChange(await req.json().catch(() => ({})), admin.ctx.account.email);
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));

    const now = new Date();
    const secure = isSecureRequest(req.headers, req.url);
    const refused = await checkCurrentPassword(admin.ctx, parsed.value.currentPassword, { secure, now });
    if (refused) return refused;
    if (!(await changeAccountPassword(admin.ctx, parsed.value.newPassword, now))) return accountChanged();

    const res = noStore(NextResponse.json({ data: { signedOut: true } }));
    const cookie = clearedSessionCookie(secure);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  },
  { route: 'PATCH /api/admin/account/password' },
);
