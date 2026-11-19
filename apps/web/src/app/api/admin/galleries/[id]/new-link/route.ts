import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { newLink } from '@/lib/galleries/galleries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** A new random part of the address (D5.3): the old link stops working at once. */
export const POST = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const slug = await newLink(id);
    return noStore(NextResponse.json({ data: { id, slug } }));
  },
  { route: 'POST /api/admin/galleries/[id]/new-link' },
);
