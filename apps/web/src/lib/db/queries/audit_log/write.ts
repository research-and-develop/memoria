import { statement, type SqlValue, type Statement } from '@repo/db/client';

import type { AuditEntry } from './types';

function auditValues(entry: AuditEntry): SqlValue[] {
  return [crypto.randomUUID(), entry.action, entry.entity, entry.entityId ?? null, entry.summary ?? '', JSON.stringify(entry.details ?? {})];
}

/** The audit insert, to put in the SAME batch as the change it records. */
export function auditStatement(entry: AuditEntry): Statement {
  return statement('INSERT INTO audit_log (id, action, entity, entity_id, summary, details) VALUES (?, ?, ?, ?, ?, ?)', auditValues(entry));
}

/**
 * The audit insert, written only when `condition` (SQL, with `params`) holds
 * when the statement runs — e.g. "the row is gone" after a guarded DELETE in
 * the same batch, so a refused delete leaves no audit entry.
 */
export function conditionalAuditStatement(entry: AuditEntry, condition: string, params: readonly SqlValue[]): Statement {
  return statement(`INSERT INTO audit_log (id, action, entity, entity_id, summary, details) SELECT ?, ?, ?, ?, ?, ? WHERE ${condition}`, [
    ...auditValues(entry),
    ...params,
  ]);
}
