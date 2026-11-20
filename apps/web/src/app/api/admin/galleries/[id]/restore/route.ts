import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { restoreGallery } from '@/lib/galleries/galleries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Restore a deleted gallery (D5.17) within its 7 days: its pending purge is cancelled in the same
 * batch. 404 for a missing or live gallery; 409 `RESTORE_WINDOW_PASSED` after the window.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    await restoreGallery(id);
    logger.info({ event: 'gallery_restored', galleryId: id });
    return noStore(NextResponse.json({ data: { id } }));
  },
  { route: 'POST /api/admin/galleries/[id]/restore' },
);
