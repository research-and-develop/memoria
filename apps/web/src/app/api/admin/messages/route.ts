import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';

import { listInbox } from '@/lib/admin/inbox';
import { parseInboxQuery } from '@/lib/admin/parseInboxQuery';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The inbox, newest first, one page (`?page=1&page_size=20`). */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const parsed = parseInboxQuery(req.nextUrl.searchParams);
    if (!parsed.ok) return invalidParamsError(parsed.message, parsed.field);
    const messages = await listInbox(parsed.value);
    return NextResponse.json({ data: messages, page: parsed.value.page, pageSize: parsed.value.pageSize });
  },
  { route: 'GET /api/admin/messages' },
);
