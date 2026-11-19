import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { addSet } from '@/lib/galleries/manager';
import { parseSetName } from '@/lib/galleries/parseManagerInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Add a set at the end (at most 50 per gallery: 400 `TOO_MANY_SETS`). `{ data: { id } }`. */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const name = parseSetName(await req.json().catch(() => ({})));
    if (!name.ok) return noStore(invalidParamsError(name.message, name.field));
    return noStore(NextResponse.json({ data: { id: await addSet(id, name.value) } }, { status: 201 }));
  },
  { route: 'POST /api/admin/galleries/[id]/sets' },
);
