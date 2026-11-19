import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { listManagerPhotos } from '@/lib/galleries/manager';
import { decodeCursor } from '@/lib/galleries/sortKey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** A page (at most 200) of one set's ready and uploading photos, hidden included, in order: `{ data, next }` (D5.14). */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const query = req.nextUrl.searchParams;
    const setId = query.get('set_id');
    if (!setId || !isUuid(setId)) return noStore(invalidParamsError('Choose a set.', 'set_id'));
    const cursor = query.get('cursor');
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && after === null) return noStore(invalidParamsError('Invalid cursor', 'cursor'));
    const page = await listManagerPhotos(id, { setId, after });
    return noStore(NextResponse.json({ data: page.photos, next: page.next }));
  },
  { route: 'GET /api/admin/galleries/[id]/photos' },
);
