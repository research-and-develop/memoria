import { NextResponse, type NextRequest } from 'next/server';

import { withErrorHandling } from '@repo/api/withErrorHandling';

import { noStore } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { signOutOtherSessions } from '@/lib/auth/securitySettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign out every device but this one (confirm). */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    await signOutOtherSessions(admin.ctx.sessionId);
    return noStore(NextResponse.json({ data: { ok: true } }));
  },
  { route: 'POST /api/admin/sessions/sign-out-others' },
);
