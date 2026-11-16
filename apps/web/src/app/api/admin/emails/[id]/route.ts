import { NextResponse, type NextRequest } from 'next/server';

import { notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { noStore } from '@/lib/auth/codeStep';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { findEmail } from '@/lib/email/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** One email's status (the test email's live line polls it). */
export const GET = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return noStore(notFoundError());
    const email = await findEmail(id);
    if (!email) return noStore(notFoundError());
    return noStore(NextResponse.json({ data: email }));
  },
  { route: 'GET /api/admin/emails/[id]' },
);
