import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { removeSet, renameSet } from '@/lib/galleries/manager';
import { parseSetName } from '@/lib/galleries/parseManagerInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; setId: string }> };

/** Rename a set. */
export const PATCH = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id, setId } = await params;
    if (!isUuid(id) || !isUuid(setId)) return notFoundError();
    const name = parseSetName(await req.json().catch(() => ({})));
    if (!name.ok) return noStore(invalidParamsError(name.message, name.field));
    await renameSet(id, setId, name.value);
    return noStore(NextResponse.json({ data: { id: setId, name: name.value } }));
  },
  { route: 'PATCH /api/admin/galleries/[id]/sets/[setId]' },
);

/** Delete an empty set; never the last one (409 `SET_NOT_EMPTY`). */
export const DELETE = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id, setId } = await params;
    if (!isUuid(id) || !isUuid(setId)) return notFoundError();
    await removeSet(id, setId);
    return noStore(NextResponse.json({ data: { id: setId } }));
  },
  { route: 'DELETE /api/admin/galleries/[id]/sets/[setId]' },
);
