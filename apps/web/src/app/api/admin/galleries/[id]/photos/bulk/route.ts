import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { bulkPhotos } from '@/lib/galleries/manager';
import { parseBulk } from '@/lib/galleries/parseManagerInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Move, hide, show or delete up to 90 ready photos: `{ data: { changed } }`. */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const parsed = parseBulk(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const changed = await bulkPhotos(id, parsed.value.ids, parsed.value.bulk);
    logger.info({ event: 'photos_bulk', galleryId: id, action: parsed.value.bulk.action, changed });
    return noStore(NextResponse.json({ data: { changed } }));
  },
  { route: 'POST /api/admin/galleries/[id]/photos/bulk' },
);
