import { NextResponse, type NextRequest } from 'next/server';

import { withErrorHandling } from '@repo/api/withErrorHandling';

import { noStore } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor, settingsKeys } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { regenerateRecoveryCodes } from '@/lib/auth/securitySettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** New recovery codes (confirm): 10 new ones replace every old one, shown once. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    const keys = await settingsKeys();
    if (keys instanceof NextResponse) return keys;
    const recoveryCodes = await regenerateRecoveryCodes(admin.ctx.sessionId, keys);
    return noStore(NextResponse.json({ data: { recoveryCodes } }));
  },
  { route: 'POST /api/admin/recovery-codes' },
);
