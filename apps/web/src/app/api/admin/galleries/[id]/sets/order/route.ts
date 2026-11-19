import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { reorderSets } from '@/lib/galleries/manager';
import { parseSetOrder } from '@/lib/galleries/parseManagerInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** The sets in a new order: `{ ids }`, every set once. */
export const PUT = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const order = parseSetOrder(await req.json().catch(() => ({})));
    if (!order.ok) return noStore(invalidParamsError(order.message, order.field));
    await reorderSets(id, order.value);
    return noStore(NextResponse.json({ data: { ids: order.value } }));
  },
  { route: 'PUT /api/admin/galleries/[id]/sets/order' },
);
