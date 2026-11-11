import { statement, type Options } from '@repo/db/client';

import type { AuditEntry } from './types';

/** The audit insert, to put in the SAME batch as the change it records. */
export function auditStatement(entry: AuditEntry, opts?: Options): D1PreparedStatement {
  return statement(
    'INSERT INTO audit_log (id, action, entity, entity_id, summary, details) VALUES (?, ?, ?, ?, ?, ?)',
    [
      crypto.randomUUID(),
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.summary ?? '',
      JSON.stringify(entry.details ?? {}),
    ],
    opts,
  );
}

/**
 * The audit insert, written only when `condition` (SQL, with `params`) holds
 * when the statement runs — e.g. "the row is gone" after a guarded DELETE in
 * the same batch, so a refused delete leaves no audit entry.
 */
export function conditionalAuditStatement(entry: AuditEntry, condition: string, params: unknown[], opts?: Options): D1PreparedStatement {
  return statement(
    `INSERT INTO audit_log (id, action, entity, entity_id, summary, details) SELECT ?, ?, ?, ?, ?, ? WHERE ${condition}`,
    [crypto.randomUUID(), entry.action, entry.entity, entry.entityId ?? null, entry.summary ?? '', JSON.stringify(entry.details ?? {}), ...params],
    opts,
  );
}
