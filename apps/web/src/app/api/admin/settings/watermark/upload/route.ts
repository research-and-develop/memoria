import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, tooManyRequestsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { hitRateLimits } from '@/lib/security/rateLimit';
import { isWatermarkImageType, WATERMARK_MAX_BYTES } from '@/lib/settings/parseWatermarkInput';
import { canUseImageWatermark, mintWatermarkUpload } from '@/lib/settings/watermark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uploads minted per hour: plenty to try a few images, few enough to bound a stolen session. */
const UPLOADS_PER_HOUR = 20;

/**
 * Mint the upload of a watermark image (plan p04 D4.9): a presigned PUT straight to R2 (or the
 * development route), never through this Worker. The key is generated here; the size the browser
 * declares is signed into the dev token but not by a presigned PUT, so `PATCH …/watermark` re-checks
 * the stored object with `head()`.
 */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const body = (await req.json().catch(() => ({}))) as { contentType?: unknown; size?: unknown };
    if (!isWatermarkImageType(body.contentType)) return noStore(invalidParamsError('Choose a PNG or WebP image.', 'contentType'));
    const size = body.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > WATERMARK_MAX_BYTES) {
      return noStore(invalidParamsError('The image must be at most 2 MB.', 'size'));
    }
    if (!canUseImageWatermark()) return signInError(409, 'MEDIA_DOMAIN_REQUIRED', 'An image watermark needs the public media domain. Use a text watermark until it is set.');
    const limit = await hitRateLimits([{ bucket: 'watermark_upload', limit: UPLOADS_PER_HOUR, windowSeconds: 3600 }]);
    if (limit.limited) return noStore(tooManyRequestsError(limit.retryAfterSeconds, 'Too many uploads. Try again later.'));
    return noStore(NextResponse.json({ data: await mintWatermarkUpload(body.contentType, size) }));
  },
  { route: 'POST /api/admin/settings/watermark/upload' },
);
