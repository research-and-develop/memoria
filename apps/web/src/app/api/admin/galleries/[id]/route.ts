import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { galleryView, patchGallery, requireGallery, softDeleteGallery } from '@/lib/galleries/galleries';
import { parseGalleryPatch } from '@/lib/galleries/parseGalleryInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** A gallery for the manager and the upload worker (no sealed password). */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    return noStore(NextResponse.json({ data: await galleryView(await requireGallery(id)) }));
  },
  { route: 'GET /api/admin/galleries/[id]' },
);

/** Edit a gallery: only the fields sent; never its processing profile (D5.4). */
export const PATCH = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const parsed = parseGalleryPatch(await req.json().catch(() => ({})));
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    await patchGallery(id, parsed.value);
    logger.info({ event: 'gallery_updated', galleryId: id, fields: Object.keys(parsed.value).filter((k) => k !== 'password') });
    return noStore(NextResponse.json({ data: await galleryView(await requireGallery(id)) }));
  },
  { route: 'PATCH /api/admin/galleries/[id]' },
);

/**
 * Delete (D5.17): soft, at once; `gallery.purge` removes it for good after 7 days (Restore until then).
 * `{ data: { purgeAt } }`.
 */
export const DELETE = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const { purgeAt } = await softDeleteGallery(id);
    logger.info({ event: 'gallery_deleted', galleryId: id });
    return noStore(NextResponse.json({ data: { id, purgeAt } }));
  },
  { route: 'DELETE /api/admin/galleries/[id]' },
);
