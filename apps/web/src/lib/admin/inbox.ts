import 'server-only';

import { AppError } from '@repo/core/error';
import { batch, type Options } from '@repo/db/client';

import { conditionalAuditStatement } from '@/lib/db/queries/audit_log';
import { deleteContactMessageStatement, listContactMessages, markContactMessageReadStatement, type ContactMessageRow } from '@/lib/db/queries/contact_messages';

/**
 * The admin's inbox — the reference for an admin write: the change and its
 * audit row go in ONE batch, the audit row is written only if the change hit a
 * row (`changes() > 0` right after it, on the same connection), and a missing
 * row is a 404. Never read-check-write across two round trips.
 */
export const INBOX_PAGE_SIZE_MAX = 100;

export function listInbox(page: { page: number; pageSize: number }, opts?: Options): Promise<ContactMessageRow[]> {
  const pageSize = Math.min(Math.max(1, page.pageSize), INBOX_PAGE_SIZE_MAX);
  return listContactMessages({ limit: pageSize, offset: (Math.max(1, page.page) - 1) * pageSize }, opts);
}

const notFound = () => new AppError('Message not found', 'NOT_FOUND', { message: 'This message no longer exists.' });

export async function setMessageRead(id: string, isRead: boolean, opts?: Options): Promise<void> {
  const [change] = await batch(
    [
      markContactMessageReadStatement(id, isRead, opts),
      conditionalAuditStatement({ action: 'update', entity: 'contact_messages', entityId: id, summary: isRead ? 'Marked as read' : 'Marked as unread' }, 'changes() > 0', [], opts),
    ],
    opts,
  );
  // `changes` also counts trigger writes on tables that have them: compare with 0.
  if (!change || change.meta.changes === 0) throw notFound();
}

export async function deleteMessage(id: string, opts?: Options): Promise<void> {
  const [change] = await batch(
    [
      deleteContactMessageStatement(id, opts),
      conditionalAuditStatement({ action: 'delete', entity: 'contact_messages', entityId: id, summary: 'Message deleted' }, 'changes() > 0', [], opts),
    ],
    opts,
  );
  if (!change || change.meta.changes === 0) throw notFound();
}
