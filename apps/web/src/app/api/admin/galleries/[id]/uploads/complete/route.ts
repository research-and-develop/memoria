import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseCompleteInput } from '@/lib/galleries/parseUploadInput';
import { completeUploads } from '@/lib/galleries/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Complete up to 8 photos (plan p05 D5.8): each one's three objects are checked with `head()` (present,
 * the declared sizes and types), then the good ones become ready in one batch. `{ ready, failed }`.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const parsed = parseCompleteInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const result = await completeUploads(id, parsed.value.photoIds);
    logger.info({ event: 'uploads_completed', galleryId: id, ready: result.ready.length, failed: result.failed.length });
    return noStore(NextResponse.json({ data: result }));
  },
  { route: 'POST /api/admin/galleries/[id]/uploads/complete' },
);
