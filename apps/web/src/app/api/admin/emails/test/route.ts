import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { parseEmailAddress } from '@repo/core/email';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { findEmail, queueTestEmail } from '@/lib/email/admin';
import { hitRateLimits } from '@/lib/security/rateLimit';
import { isMailConfigured } from '@/lib/settings/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Test emails per hour: enough to fix a setting, too few to spam anyone with a stolen session. */
const TEST_EMAILS_PER_HOUR = 3;

/** Settings → Emails → Test email: queue one (one attempt), wake the relay, answer its status. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const body = (await req.json().catch(() => ({}))) as { to?: unknown };
    const to = parseEmailAddress(body.to);
    if (!to) return noStore(invalidParamsError('Enter the address to send the test to.', 'to'));
    if (!(await isMailConfigured())) return signInError(409, 'MAIL_NOT_CONFIGURED', 'Choose how to send email and save it first.');
    const now = new Date();
    const limit = await hitRateLimits([{ bucket: 'email_test', limit: TEST_EMAILS_PER_HOUR, windowSeconds: 3600 }], { now });
    if (limit.limited) return noStore(tooManyRequestsError(limit.retryAfterSeconds, `You can send ${TEST_EMAILS_PER_HOUR} test emails an hour. Try again later.`));
    const id = await queueTestEmail(to, now);
    return noStore(NextResponse.json({ data: await findEmail(id) }, { status: 202 }));
  },
  { route: 'POST /api/admin/emails/test' },
);
