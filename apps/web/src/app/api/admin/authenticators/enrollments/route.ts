import { NextResponse, type NextRequest } from 'next/server';

import { withErrorHandling } from '@repo/api/withErrorHandling';
import { getPlatform } from '@repo/platform/current';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor, settingsKeys } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { startEnrollment } from '@/lib/auth/securitySettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Start adding an authenticator app (confirm): a new secret to scan, valid 10 minutes. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const confirm = requireRecentSecondFactor(admin.ctx);
    if (confirm) return confirm;
    const keys = await settingsKeys();
    if (keys instanceof NextResponse) return keys;

    const config = getPlatform().config();
    const result = await startEnrollment({
      sessionId: admin.ctx.sessionId,
      passwordHash: config.admin.passwordHash,
      userAgent: req.headers.get('user-agent') ?? '',
      issuer: config.appName,
      account: config.admin.email,
      keys,
      now: new Date(),
    });
    if (result === 'too_many_apps') return signInError(409, 'AUTHENTICATOR_LIMIT', 'You have 10 authenticator apps. Remove one to add another.');
    if (result === 'too_many_setups') return signInError(409, 'AUTHENTICATOR_LIMIT', 'Too many unfinished setups. Finish one, or wait 10 minutes.');
    return noStore(NextResponse.json({ data: result }));
  },
  { route: 'POST /api/admin/authenticators/enrollments' },
);
