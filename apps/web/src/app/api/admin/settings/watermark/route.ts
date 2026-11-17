import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';

import { noStore, signInError } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { changedWatermarkFields, parseWatermarkInput } from '@/lib/settings/parseWatermarkInput';
import { canUseImageWatermark, checkWatermarkUpload, readWatermark, saveWatermark, watermarkView } from '@/lib/settings/watermark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Settings → Watermarks (plan p04 D4.9, D4.14): the watermark and the URL its image loads from. */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    return noStore(NextResponse.json({ data: await watermarkView(await readWatermark()) }));
  },
  { route: 'GET /api/admin/settings/watermark' },
);

/**
 * Save the watermark (no code: it cannot redirect links or lock anyone out, D4.12). An image must
 * have been uploaded through `POST …/watermark/upload` and is checked with `head()`; `none` removes
 * the watermark. Audited with the field names only.
 */
export const PATCH = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const parsed = parseWatermarkInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const watermark = parsed.value;

    if (watermark.kind === 'image') {
      if (!canUseImageWatermark()) return signInError(409, 'MEDIA_DOMAIN_REQUIRED', 'An image watermark needs the public media domain. Use a text watermark until it is set.');
      const upload = await checkWatermarkUpload(watermark);
      if (upload === 'missing') return signInError(400, 'UPLOAD_MISSING', 'The image did not finish uploading. Choose it again.', { field: 'key' });
      if (upload === 'invalid') return signInError(400, 'UPLOAD_INVALID', 'The uploaded file is not a PNG or WebP of at most 2 MB.', { field: 'key' });
    }

    const fields = changedWatermarkFields(await readWatermark(), watermark);
    if (fields.length > 0) {
      await saveWatermark(watermark, fields);
      logger.info({ event: 'watermark_settings_changed', fields, session: admin.ctx.sessionId.slice(0, 12) });
    }
    return noStore(NextResponse.json({ data: await watermarkView(watermark) }));
  },
  { route: 'PATCH /api/admin/settings/watermark' },
);
