import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * The D1 access layer. Every query function takes `opts?: Options` LAST and
 * threads it here, so a test (or a caller holding another binding) can point it
 * at a specific database; without one it resolves the request's `env.DB`.
 *
 * D1 is SQLite behind an HTTP-ish API. Three differences from a pg pool bite:
 *   1. NO interactive transactions. `BEGIN`/`COMMIT` are rejected. The unit of
 *      atomicity is `batch()`: its statements run in order and either all
 *      commit or all roll back. Reads between your writes are not isolated —
 *      enforce invariants in SQL (constraints, `WHERE` on the write itself).
 *   2. Placeholders are `?` (or `?1`, `?2`), not `$1`.
 *   3. `undefined` cannot be bound (D1_TYPE_ERROR). Pass `null`.
 */
export type Options = {
  db?: D1Database;
};

// On globalThis, never a module-level `let`: Next's server build can duplicate
// a module across chunks, and a test override set in one copy must be seen by
// the copy the route imported.
const TEST_DB_KEY = Symbol.for('repo.db.testOverride');
type OverrideHolder = { [TEST_DB_KEY]?: D1Database | null };
const holder = globalThis as OverrideHolder;

/** Test-only: route every un-scoped query to `db` (null clears). Use `useTestDb` from ./test-utils. */
export function setDbOverride(db: D1Database | null): void {
  holder[TEST_DB_KEY] = db;
}

/**
 * The database for this call. Inside a request (route handler, server
 * component, server action) the binding comes from the Worker's env. Outside
 * one — e.g. while `next build` prerenders a static page — the synchronous
 * context does not exist; such code must `await getCloudflareContext({ async: true })`.
 */
export function getDb(opts?: Options): D1Database {
  if (opts?.db) return opts.db;
  const override = holder[TEST_DB_KEY];
  if (override) return override;
  return getCloudflareContext().env.DB;
}

/** A prepared, bound statement — the unit `batch()` takes. Executes nothing. */
export function statement(sql: string, params: unknown[] = [], opts?: Options): D1PreparedStatement {
  const prepared = getDb(opts).prepare(sql);
  return params.length ? prepared.bind(...params) : prepared;
}

/** All rows. */
export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[], opts?: Options): Promise<T[]> {
  const { results } = await statement(sql, params, opts).all<T>();
  return results;
}

/** The first row, or null. */
export async function queryFirst<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
  opts?: Options,
): Promise<T | null> {
  return statement(sql, params, opts).first<T>();
}

/**
 * A write. `meta.changes` is the affected row count (0 = nothing matched). A
 * table with triggers counts their writes too, so compare it with 0, never with
 * an exact count.
 */
export async function execute(sql: string, params?: unknown[], opts?: Options): Promise<D1Meta> {
  const { meta } = await statement(sql, params, opts).run();
  return meta;
}

/**
 * Run several statements ATOMICALLY: in order, all-or-nothing. This is the
 * replacement for a transaction — a change and its audit row go in ONE batch.
 * A statement that fails rolls back every earlier statement of the batch and
 * rejects with that statement's error.
 */
export async function batch<T = Record<string, unknown>>(
  statements: D1PreparedStatement[],
  opts?: Options,
): Promise<D1Result<T>[]> {
  if (statements.length === 0) return [];
  return getDb(opts).batch<T>(statements);
}
