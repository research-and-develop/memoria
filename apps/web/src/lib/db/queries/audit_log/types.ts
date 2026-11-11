import { readJson } from '@repo/db/rows';

/** Must match ck_audit_log_action (migration 0001). */
export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'login', 'logout'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Mirrors `audit_log`: one row per admin change, written in the change's own batch. */
export type AuditLogRow = {
  id: string;
  action: AuditAction;
  /** Table / area changed ("contact_messages", "site_settings", "session"). */
  entity: string;
  entity_id: string | null;
  /** Human-readable. Never personal data of a visitor (no names, emails, messages). */
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type AuditLogDbRow = Omit<AuditLogRow, 'details'> & { details: string };

export type AuditEntry = {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
};

export const AUDIT_LOG_COLUMNS = 'id, action, entity, entity_id, summary, details, created_at';

export const toAuditLogRow = (row: AuditLogDbRow): AuditLogRow => ({ ...row, details: readJson(row.details, {}) });
