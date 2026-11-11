import { statement, type Options } from '@repo/db/client';

import { allRows } from '@repo/db/rows';

import { AUDIT_LOG_COLUMNS, toAuditLogRow, type AuditLogDbRow, type AuditLogRow } from './types';

/** The latest entries (the admin dashboard). Uses ix_audit_log_created_at. */
export function listRecentAudit(limit: number, opts?: Options): Promise<AuditLogRow[]> {
  return allRows<AuditLogDbRow, AuditLogRow>(
    statement(`SELECT ${AUDIT_LOG_COLUMNS} FROM audit_log ORDER BY created_at DESC LIMIT ?`, [limit], opts),
    toAuditLogRow,
  );
}
