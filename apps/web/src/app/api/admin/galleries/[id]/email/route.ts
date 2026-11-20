import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { findEmail } from '@/lib/email/admin';
import { parseShareEmailInput } from '@/lib/galleries/parseShareInput';
import { queueGalleryEmail } from '@/lib/galleries/sharing';
import { hitRateLimits } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Client emails per hour, across galleries (D5.20). */
const GALLERY_EMAILS_PER_HOUR = 20;

/**
 * *Email the client* (D5.20): 409 `NOT_PUBLISHED` for a draft, 409 `SITE_URL_REQUIRED` without a
 * website address, else the `gallery.ready` job + its audit row (no address), nudged. 202 with the
 * email's status, which the panel then follows.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const parsed = parseShareEmailInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const gallery = await getGallery(id);
    if (!gallery || gallery.deleted_at) return notFoundError();
    const now = new Date();
    const limit = await hitRateLimits([{ bucket: 'gallery_email', limit: GALLERY_EMAILS_PER_HOUR, windowSeconds: 3600 }], { now });
    if (limit.limited) {
      return noStore(tooManyRequestsError(limit.retryAfterSeconds, `You can send ${GALLERY_EMAILS_PER_HOUR} gallery emails an hour. Try again later.`));
    }
    const jobId = await queueGalleryEmail({ gallery, ...parsed.value, now });
    return noStore(NextResponse.json({ data: await findEmail(jobId) }, { status: 202 }));
  },
  { route: 'POST /api/admin/galleries/[id]/email' },
);
