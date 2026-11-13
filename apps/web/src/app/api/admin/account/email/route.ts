import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { accountChanged, changeAccountEmail, checkCurrentPassword } from '@/lib/auth/accountChange';
import { noStore } from '@/lib/auth/codeStep';
import { parseEmailChange } from '@/lib/auth/parseAccountInput';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isSecureRequest } from '@/lib/security/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change the sign-in email (plan p02b): rate limits → a recent code → the
 * current password (lib/auth/accountChange.ts). Every session stays.
 */
export const PATCH = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const parsed = parseEmailChange(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));

    const now = new Date();
    const refused = await checkCurrentPassword(admin.ctx, parsed.value.currentPassword, { secure: isSecureRequest(req.headers, req.url), now });
    if (refused) return refused;
    if (!(await changeAccountEmail(admin.ctx, parsed.value.email, now))) return accountChanged();
    return noStore(NextResponse.json({ data: { email: parsed.value.email } }));
  },
  { route: 'PATCH /api/admin/account/email' },
);
