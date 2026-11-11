import { NextResponse, type NextRequest } from 'next/server';

import { invalidParamsError, notFoundError } from '@repo/api/responses';
import { withErrorHandling } from '@repo/api/withErrorHandling';
import { isUuid } from '@repo/core/validation';

import { deleteMessage, setMessageRead } from '@/lib/admin/inbox';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Mark read / unread: `{ "isRead": true }`. */
export const PATCH = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    const body = (await req.json().catch(() => ({}))) as { isRead?: unknown };
    if (typeof body.isRead !== 'boolean') return invalidParamsError('isRead must be a boolean', 'isRead');
    await setMessageRead(id, body.isRead);
    return NextResponse.json({ data: { id, isRead: body.isRead } });
  },
  { route: 'PATCH /api/admin/messages/[id]' },
);

export const DELETE = withErrorHandling(
  async (req: NextRequest, { params }: Params) => {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.response;
    const { id } = await params;
    if (!isUuid(id)) return notFoundError();
    await deleteMessage(id);
    return NextResponse.json({ data: { id } });
  },
  { route: 'DELETE /api/admin/messages/[id]' },
);
