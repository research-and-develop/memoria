import { statement, type Options } from '@repo/db/client';

import type { ContactMessageInput } from './types';

/** The insert, to batch with whatever must be written with it. */
export function createContactMessageStatement(id: string, input: ContactMessageInput, opts?: Options): D1PreparedStatement {
  return statement(
    'INSERT INTO contact_messages (id, name, email, message, consent_at) VALUES (?, ?, ?, ?, ?)',
    [id, input.name, input.email, input.message, input.consentAt],
    opts,
  );
}

export function markContactMessageReadStatement(id: string, isRead: boolean, opts?: Options): D1PreparedStatement {
  return statement('UPDATE contact_messages SET is_read = ? WHERE id = ?', [isRead ? 1 : 0, id], opts);
}

export function deleteContactMessageStatement(id: string, opts?: Options): D1PreparedStatement {
  return statement('DELETE FROM contact_messages WHERE id = ?', [id], opts);
}
