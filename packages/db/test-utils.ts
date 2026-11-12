import { createProxy } from '@repo/platform-cloudflare/testing/proxy';
import type { Db, Statement } from '@repo/platform/ports';
import { setTestDb } from '@repo/platform/testing/platform';

import { migrationStatements } from './migrations';

/**
 * A real, local database for tests: D1 in workerd through wrangler's `getPlatformProxy`, IN MEMORY
 * (`persist: false` — nothing touches `.wrangler/state`), with the repo's migrations applied
 * exactly as `wrangler d1 migrations apply` would. `db` is the `Db` port, as the app sees it.
 *
 * One database per test FILE (startup is ~1 s), wiped between tests:
 *
 *   const testDb = await createTestDb();
 *   afterEach(() => testDb.reset());
 *   afterAll(() => testDb.dispose());
 *
 *   await upsertSiteSetting('branding', { studioName: '…' }, { db: testDb.db });
 *
 * Raw SQL in a test: `run(statement(…), { db: testDb.db })` from @repo/db/client.
 */
export type TestDb = {
  db: Db;
  /** Delete every row of every app table (the schema stays). */
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
};

export type TestDbOptions = {
  /**
   * Tables whose rows `reset()` keeps — e.g. a singleton row a migration seeds
   * and triggers maintain. Every other app table is emptied.
   */
  keep?: readonly string[];
};

const sql = (text: string): Statement => ({ sql: text, params: [] });

export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const proxy = await createProxy();
  const db = proxy.db;
  for (const { statements } of migrationStatements()) {
    if (statements.length) await db.batch(statements.map(sql));
  }
  return { db, reset: () => resetTables(db, options.keep ?? []), dispose: proxy.dispose };
}

/**
 * Route tests: send every un-scoped query (`getDb()` without `{ db }`) to the
 * test database, through the test platform. Clear it in afterEach with `useTestDb(null)`.
 */
export function useTestDb(db: Db | null): void {
  setTestDb(db);
}

/** Empty every app table except `keep`; wrangler's and SQLite's own tables are never touched. */
async function resetTables(db: Db, keep: readonly string[]): Promise<void> {
  const rows = await db.all<{ name: string }>(
    sql(`SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
            AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'`),
  );
  const tables = rows.map((r) => r.name).filter((name) => !keep.includes(name));
  // Foreign keys are checked at the END of the batch (D1 supports deferring
  // them), so the tables can be emptied in any order.
  if (tables.length) {
    await db.batch([sql('PRAGMA defer_foreign_keys = on'), ...tables.map((name) => sql(`DELETE FROM "${name}"`))]);
  }
}
