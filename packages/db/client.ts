import 'server-only';

import { getPlatform } from '@repo/platform/current';
import type { BatchResult, Db, SqlValue, Statement, WriteResult } from '@repo/platform/ports';

/**
 * The database layer, on the `Db` port (D1 in production; see @repo/platform-cloudflare/d1).
 * Every executing function takes `opts?: Options` LAST and threads it here, so a test (or a caller
 * holding another database) can point it at a specific `Db`; without one it uses the platform's.
 * Statements are plain data: building one executes nothing and needs no database.
 *
 * The dialect is SQLite, and three things bite:
 *   1. NO interactive transactions. `BEGIN`/`COMMIT` are rejected. The unit of
 *      atomicity is `batch()`: its statements run in order and either all
 *      commit or all roll back. Reads between your writes are not isolated —
 *      enforce invariants in SQL (constraints, `WHERE` on the write itself).
 *   2. Placeholders are `?` (or `?1`, `?2`), not `$1`.
 *   3. `undefined` cannot be bound. Pass `null`. Booleans neither: `fromBool` (@repo/db/rows).
 */
export type Options = {
  db?: Db;
};

export type { BatchResult, Db, SqlValue, Statement, WriteResult };

/**
 * The database for this call: `opts.db`, else the platform's. Only inside a request (route
 * handler, server component, server action): the platform does not exist at import time or
 * while `next build` prerenders a static page.
 */
export function getDb(opts?: Options): Db {
  return opts?.db ?? getPlatform().db();
}

/** A statement: SQL and its parameters, frozen. The unit `batch()` takes. Executes nothing. */
export function statement(sql: string, params: readonly SqlValue[] = []): Statement {
  params.forEach((value: unknown, i) => {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`statement parameter ${i} is ${value === undefined ? 'undefined' : typeof value}: bind a string, a number or null`);
    }
  });
  return Object.freeze({ sql, params: Object.freeze([...params]) });
}

/** All rows of a statement. */
export function all<T = Record<string, unknown>>(stmt: Statement, opts?: Options): Promise<T[]> {
  return getDb(opts).all<T>(stmt);
}

/** The first row of a statement, or null. */
export function first<T = Record<string, unknown>>(stmt: Statement, opts?: Options): Promise<T | null> {
  return getDb(opts).first<T>(stmt);
}

/**
 * A write. `changes` is the affected row count (0 = nothing matched). A table with triggers
 * counts their writes too, so compare it with 0, never with an exact count.
 */
export function run(stmt: Statement, opts?: Options): Promise<WriteResult> {
  return getDb(opts).run(stmt);
}

/** All rows, converted. */
export async function allRows<DbRow, Row>(stmt: Statement, convert: (row: DbRow) => Row, opts?: Options): Promise<Row[]> {
  return (await all<DbRow>(stmt, opts)).map(convert);
}

/** The first row, converted, or null. */
export async function firstRow<DbRow, Row>(stmt: Statement, convert: (row: DbRow) => Row, opts?: Options): Promise<Row | null> {
  const row = await first<DbRow>(stmt, opts);
  return row ? convert(row) : null;
}

/** All rows of `sql`. */
export function query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[], opts?: Options): Promise<T[]> {
  return all<T>(statement(sql, params), opts);
}

/** The first row of `sql`, or null. */
export function queryFirst<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[], opts?: Options): Promise<T | null> {
  return first<T>(statement(sql, params), opts);
}

/** A write of `sql`; see `run`. */
export function execute(sql: string, params?: readonly SqlValue[], opts?: Options): Promise<WriteResult> {
  return run(statement(sql, params), opts);
}

/**
 * Run several statements ATOMICALLY: in order, all-or-nothing. This is the
 * replacement for a transaction — a change and its audit row go in ONE batch.
 * A statement that fails rolls back every earlier statement of the batch and
 * rejects with that statement's error. One result per statement: `rows`, `changes`.
 */
export async function batch<T = Record<string, unknown>>(statements: readonly Statement[], opts?: Options): Promise<BatchResult<T>[]> {
  if (statements.length === 0) return [];
  return getDb(opts).batch<T>(statements);
}
