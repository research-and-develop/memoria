import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getGallery } from '@/lib/db/queries/galleries';
import { revealGalleryPassword } from '@/lib/galleries/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * The gallery's password for the sharing panel (D5.11: shown, not a credential); null for a link
 * gallery. Never cached, never logged. Changing it is `PATCH …/[id]` `{ access, password }`.
 */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const gallery = await getGallery(id);
    if (!gallery || gallery.deleted_at) return notFoundError();
    return noStore(NextResponse.json({ data: { password: await revealGalleryPassword(gallery) } }));
  },
  { route: 'GET /api/admin/galleries/[id]/password' },
);
