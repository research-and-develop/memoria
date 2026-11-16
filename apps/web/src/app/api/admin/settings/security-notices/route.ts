import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireRecentSecondFactor } from '@/lib/auth/confirm';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { setSecurityNotices } from '@/lib/email/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Security notices on or off (plan p03, D3.19). Turning them OFF needs a code (an intruder would
 * silence them first) and sends one last notice; turning them on does not.
 */
export const PUT = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') return noStore(invalidParamsError('Say whether security emails are on.', 'enabled'));
    if (!body.enabled) {
      const confirm = requireRecentSecondFactor(admin.ctx);
      if (confirm) return confirm;
    }
    await setSecurityNotices(body.enabled, new Date());
    logger.info({ event: 'security_notices_changed', enabled: body.enabled, session: admin.ctx.sessionId.slice(0, 12) });
    return noStore(NextResponse.json({ data: { enabled: body.enabled } }));
  },
  { route: 'PUT /api/admin/settings/security-notices' },
);
