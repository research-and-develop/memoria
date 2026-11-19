import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseRegisterInput } from '@/lib/galleries/parseUploadInput';
import { registerUploads } from '@/lib/galleries/uploads';
import { hitRateLimits } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Register requests per hour: 6,000 photos, far above a real upload, a ceiling for a stolen session. */
const REGISTERS_PER_HOUR = 600;

/**
 * Register up to 10 photos (plan p05 D5.8, D5.9): per photo `new` or `resume` with three presigned PUTs
 * (the original to the private bucket, the thumbnail and display copy to media), or `duplicate`.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const parsed = parseRegisterInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const limit = await hitRateLimits([{ bucket: 'upload_register', limit: REGISTERS_PER_HOUR, windowSeconds: 3600 }]);
    if (limit.limited) return noStore(tooManyRequestsError(limit.retryAfterSeconds, 'Too many uploads in an hour. Try again later.'));
    const photos = await registerUploads(id, parsed.value);
    logger.info({
      event: 'uploads_registered',
      galleryId: id,
      new: photos.filter((p) => p.status === 'new').length,
      resume: photos.filter((p) => p.status === 'resume').length,
      duplicate: photos.filter((p) => p.status === 'duplicate').length,
    });
    return noStore(NextResponse.json({ data: photos }));
  },
  { route: 'POST /api/admin/galleries/[id]/uploads' },
);
