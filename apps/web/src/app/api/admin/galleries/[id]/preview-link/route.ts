import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { AppError } from '@repo/core/error';
import { isUuid } from '@repo/core/validation';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { PREVIEW_TTL_SECONDS, signPreviewToken } from '@/lib/edge/gallery/access';
import { galleryKeysFor } from '@/lib/edge/gallery/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * *View as client* (plan p06 D6.11): a one-hour link `/g/<slug>?preview=<expiry>.<MAC>` that opens the
 * gallery while it is a DRAFT (a password draft too); on a published gallery the token is ignored and
 * the normal access rules apply. Not revocable within its hour (it shows only what the photographer is
 * about to publish). Writes nothing: the token is a MAC under the preview key.
 */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const gallery = await getGallery(id);
    if (!gallery || gallery.deleted_at) return notFoundError();
    const keys = await galleryKeysFor(getPlatform().config().settingsKey);
    if (!keys) {
      logger.error({ event: 'gallery_key_missing' });
      throw new AppError('Gallery keys are not configured', 'GALLERY_KEY_MISSING', {
        status: 503,
        message: 'Previews need SETTINGS_ENCRYPTION_KEY. Ask whoever installed this site.',
      });
    }
    const now = new Date();
    const token = await signPreviewToken(keys.preview, { galleryId: id, now });
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_SECONDS * 1000).toISOString();
    return noStore(NextResponse.json({ data: { url: `/g/${gallery.slug}?preview=${token}`, expiresAt } }));
  },
  { route: 'POST /api/admin/galleries/[id]/preview-link' },
);
