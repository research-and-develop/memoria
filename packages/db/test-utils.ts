import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPlatformProxy } from 'wrangler';

import { setDbOverride } from './client';

/**
 * A real, local D1 for tests: wrangler's `getPlatformProxy` starts workerd's
 * D1 IN MEMORY (`persist: false` — nothing touches `.wrangler/state`), and the
 * repo's migrations are applied exactly as `wrangler d1 migrations apply` would.
 *
 * One database per test FILE (startup is ~1 s), wiped between tests:
 *
 *   const testDb = await createTestDb();
 *   afterEach(() => testDb.reset());
 *   afterAll(() => testDb.dispose());
 *
 *   await upsertSiteSetting('contact', { phone: '…' }, { db: testDb.db });
 *
 * The wrangler config is the app's: the test D1 gets the same binding and the
 * repo-root migrations, exactly as `wrangler d1 migrations apply` would apply them.
 */
export type TestDb = {
  db: D1Database;
  /** Delete every row of every app table (the schema stays). */
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRANGLER_CONFIG = path.join(REPO_ROOT, 'apps', 'web', 'wrangler.jsonc');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

export type TestDbOptions = {
  /**
   * Tables whose rows `reset()` keeps — e.g. a singleton row a migration seeds
   * and triggers maintain. Every other app table is emptied.
   */
  keep?: readonly string[];
};

export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: WRANGLER_CONFIG, persist: false });
  const db = proxy.env.DB;
  await applyMigrations(db);
  return { db, reset: () => resetTables(db, options.keep ?? []), dispose: () => proxy.dispose() };
}

/**
 * Route tests: send every un-scoped query (`getDb()` without `{ db }`) to the
 * test database. Clear it in afterEach with `useTestDb(null)`.
 */
export function useTestDb(db: D1Database | null): void {
  setDbOverride(db);
}

/** `0001_init.sql`, `0002_…` — wrangler's naming, applied in numeric order. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

async function applyMigrations(db: D1Database): Promise<void> {
  for (const file of migrationFiles()) {
    const statements = splitSqlStatements(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    if (statements.length) await db.batch(statements.map((sql) => db.prepare(sql)));
  }
}

/**
 * Split a migration into statements: `--` comments dropped, split on a `;`
 * that ends a line. A `CREATE TRIGGER … BEGIN … END;` body is kept whole.
 * Deliberately simple — so a migration keeps one statement per `;`-terminated
 * line group, and never puts `;` + newline inside a string literal.
 */
export function splitSqlStatements(sql: string): string[] {
  const lines = sql.split(/\r?\n/).map((line) => line.replace(/--.*$/, ''));
  const out: string[] = [];
  let current: string[] = [];
  let inTrigger = false;
  for (const line of lines) {
    current.push(line);
    const text = current.join('\n').trim();
    if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(text)) inTrigger = true;
    const ends = inTrigger ? /\bEND\s*;\s*$/i.test(line) : /;\s*$/.test(line);
    if (ends) {
      out.push(text);
      current = [];
      inTrigger = false;
    }
  }
  const rest = current.join('\n').trim();
  if (rest) out.push(rest);
  return out;
}

/** Empty every app table except `keep`; wrangler's and SQLite's own tables are never touched. */
async function resetTables(db: D1Database, keep: readonly string[]): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
          AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'`,
    )
    .all<{ name: string }>();
  const tables = results.map((r) => r.name).filter((name) => !keep.includes(name));
  // Foreign keys are checked at the END of the batch (D1 supports deferring
  // them), so the tables can be emptied in any order.
  if (tables.length) {
    await db.batch([db.prepare('PRAGMA defer_foreign_keys = on'), ...tables.map((name) => db.prepare(`DELETE FROM "${name}"`))]);
  }
}
