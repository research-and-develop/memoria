import { toBool } from '@repo/db/rows';

/** Mirrors `contact_messages`, with `is_read` as a boolean. */
export type ContactMessageRow = {
  id: string;
  name: string;
  email: string;
  message: string;
  is_read: boolean;
  consent_at: string;
  created_at: string;
};

/** The raw D1 row: booleans arrive as 0/1. Convert in this module, never in a caller. */
export type ContactMessageDbRow = Omit<ContactMessageRow, 'is_read'> & { is_read: number };

export type ContactMessageInput = { name: string; email: string; message: string; consentAt: string };

export const CONTACT_MESSAGE_COLUMNS = 'id, name, email, message, is_read, consent_at, created_at';

export function toContactMessageRow(row: ContactMessageDbRow): ContactMessageRow {
  return { ...row, is_read: toBool(row.is_read) };
}
