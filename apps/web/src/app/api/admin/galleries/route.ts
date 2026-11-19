import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { logger } from '@repo/logger';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createGallery, listGalleryCards } from '@/lib/galleries/galleries';
import { parseGalleryInput } from '@/lib/galleries/parseGalleryInput';
import { readBranding } from '@/lib/settings/branding';
import { readGalleryDefaults } from '@/lib/settings/galleryDefaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Create a gallery (plan p05 T5.3): `{ data: { id, slug } }`. */
export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const body = await req.json().catch(() => ({}));
    const [defaults, branding] = await Promise.all([readGalleryDefaults(), readBranding()]);
    const parsed = parseGalleryInput(body, { defaults, branding });
    if (!parsed.ok) return noStore(invalidParamsError(parsed.message, parsed.field));
    const created = await createGallery(parsed.value);
    logger.info({ event: 'gallery_created', galleryId: created.id, purpose: parsed.value.purpose, access: parsed.value.access });
    return noStore(NextResponse.json({ data: created }, { status: 201 }));
  },
  { route: 'POST /api/admin/galleries' },
);

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f-]{36})$/;

/**
 * The galleries list, newest first, 50 a page (`?cursor=` from the previous page's `next`;
 * `?deleted=1` = the Deleted filter). `{ data: cards, next }`.
 */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const params = req.nextUrl.searchParams;
    const rawCursor = params.get('cursor');
    let cursor = null;
    if (rawCursor) {
      const match = CURSOR_RE.exec(rawCursor);
      if (!match) return noStore(invalidParamsError('Invalid cursor', 'cursor'));
      cursor = { createdAt: match[1]!, id: match[2]! };
    }
    const { cards, next } = await listGalleryCards({ deleted: params.get('deleted') === '1', cursor });
    return noStore(NextResponse.json({ data: cards, next: next ? `${next.createdAt}|${next.id}` : null }));
  },
  { route: 'GET /api/admin/galleries' },
);
