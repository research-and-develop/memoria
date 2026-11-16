import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { findEmail, retryEmail } from '@/lib/email/admin';
import { hitRateLimits } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const RETRIES_PER_HOUR = 20;

/** Retry a failed email (Settings → Emails → Recent emails). */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return noStore(notFoundError());
    const now = new Date();
    const limit = await hitRateLimits([{ bucket: 'email_retry', limit: RETRIES_PER_HOUR, windowSeconds: 3600 }], { now });
    if (limit.limited) return noStore(tooManyRequestsError(limit.retryAfterSeconds, 'Too many retries this hour. Try again later.'));
    const outcome = await retryEmail(id, now);
    if (outcome === 'not_found') return noStore(notFoundError());
    if (outcome === 'not_failed') return signInError(409, 'EMAIL_NOT_FAILED', 'Only a failed email can be retried.');
    return noStore(NextResponse.json({ data: await findEmail(id) }));
  },
  { route: 'POST /api/admin/emails/[id]/retry' },
);
