import { NextResponse, type NextRequest } from 'next/server';

import { withErrorHandling } from '@repo/api/withErrorHandling';
import { run } from '@repo/db/client';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { acknowledgeRecoveryCodesStatement } from '@/lib/db/queries/admin_recovery_codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "I have saved these codes": the reminder banner (D2.8) stops asking. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    await run(acknowledgeRecoveryCodesStatement(new Date().toISOString()));
    return noStore(NextResponse.json({ data: { ok: true } }));
  },
  { route: 'POST /api/admin/recovery-codes/acknowledge' },
);
