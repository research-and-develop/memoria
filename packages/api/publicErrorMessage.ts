/**
 * The text of a caught error that is safe to send to the browser.
 *
 * Our own messages ("This slug is already taken") reach the user unchanged —
 * they were written for a person. What must NOT reach the browser is text the
 * DATABASE wrote: a D1/SQLite diagnostic names tables and columns
 * ("UNIQUE constraint failed: site_settings.key: SQLITE_CONSTRAINT"). Those are
 * recognisable by shape (`D1_…` / `SQLITE_…`), so only they are replaced, with
 * a readable line that keeps the error class and a `ref <reqId>` that leads to
 * the full log entry.
 */
import { logger } from '@repo/logger';

type ErrorShape = { message?: unknown; stack?: unknown };

/** The SQLite class a D1 error names: CONSTRAINT, BUSY, … or null when it is not a database error. */
function sqliteClass(message: string): string | null {
  if (!/\b(D1_[A-Z_]+|SQLITE_[A-Z_]+)\b/.test(message)) return null;
  return /\bSQLITE_([A-Z]+)/.exec(message)?.[1] ?? 'D1';
}

function databaseMessage(message: string): string {
  if (/UNIQUE constraint failed/i.test(message)) return 'This record already exists.';
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return 'This record is linked to other data, or refers to data that no longer exists.';
  }
  if (/NOT NULL constraint failed/i.test(message)) return 'A required value is missing.';
  if (/CHECK constraint failed/i.test(message)) return 'A value failed a validation rule.';
  if (/D1_TYPE_ERROR/.test(message)) return 'A value has the wrong format.';
  if (/SQLITE_BUSY|D1_RESET|overloaded|timed? ?out/i.test(message)) return 'The database is busy right now. Please try again.';
  return 'A database error occurred.';
}

function withCode(text: string, code: string, reqId: string): string {
  return `${text.replace(/\.$/, '')} (${code}, ref ${reqId}).`;
}

/** A replaced message must not be the only record: log it here unless the caller already did. */
function logReplaced(error: ErrorShape, reqId: string | undefined): string {
  if (reqId) return reqId;
  const id = crypto.randomUUID();
  logger.error({ event: 'route_error_message_replaced', reqId: id, message: error.message, stack: error.stack });
  return id;
}

/**
 * A database error the REQUEST caused (a constraint or type violation). A route
 * writing client input may answer these with 400; anything else is a server
 * error for `withErrorHandling`.
 */
export function isDbInputError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const message = (error as ErrorShape).message;
  if (typeof message !== 'string' || sqliteClass(message) === null) return false;
  return /constraint failed|D1_TYPE_ERROR/i.test(message);
}

/** Our own messages unchanged; the database's replaced. `undefined` for a nullish value. */
export function publicErrorMessage(error: Error, reqId?: string): string;
export function publicErrorMessage(error: unknown, reqId?: string): string | undefined;
export function publicErrorMessage(error: unknown, reqId?: string): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error !== 'object') return String(error);

  const e = error as ErrorShape;
  if (typeof e.message !== 'string') return undefined;
  const dbClass = sqliteClass(e.message);
  if (dbClass) return withCode(databaseMessage(e.message), dbClass, logReplaced(e, reqId));
  return e.message;
}
