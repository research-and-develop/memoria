import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { setCover } from '@/lib/galleries/manager';
import { parsePhotoId } from '@/lib/galleries/parseManagerInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** *Set as cover*: `{ photoId }`, a visible ready photo of this gallery. */
export const PUT = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const photo = parsePhotoId(await req.json().catch(() => ({})));
    if (!photo.ok) return noStore(invalidParamsError(photo.message, photo.field));
    await setCover(id, photo.value);
    return noStore(NextResponse.json({ data: { photoId: photo.value } }));
  },
  { route: 'PUT /api/admin/galleries/[id]/cover' },
);
