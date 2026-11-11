import { queryFirst, statement, type Options } from '@repo/db/client';
import { allRows } from '@repo/db/rows';

import { CONTACT_MESSAGE_COLUMNS, toContactMessageRow, type ContactMessageDbRow, type ContactMessageRow } from './types';

export async function getContactMessage(id: string, opts?: Options): Promise<ContactMessageRow | null> {
  const row = await queryFirst<ContactMessageDbRow>(`SELECT ${CONTACT_MESSAGE_COLUMNS} FROM contact_messages WHERE id = ?`, [id], opts);
  return row ? toContactMessageRow(row) : null;
}

/** Newest first, one page. Bounded and indexed (ix_contact_messages_created_at). */
export function listContactMessages(page: { limit: number; offset: number }, opts?: Options): Promise<ContactMessageRow[]> {
  return allRows(
    statement(`SELECT ${CONTACT_MESSAGE_COLUMNS} FROM contact_messages ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [page.limit, page.offset], opts),
    toContactMessageRow,
  );
}
