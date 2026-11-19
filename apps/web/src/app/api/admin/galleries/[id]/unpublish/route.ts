import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { setPublished } from '@/lib/galleries/galleries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Back to draft (D5.19): clients get 404 again. */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    await setPublished(id, false);
    return noStore(NextResponse.json({ data: { id } }));
  },
  { route: 'POST /api/admin/galleries/[id]/unpublish' },
);
