import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db, Statement } from '../ports';

/**
 * The Db contract: what every database adapter must do (D1 now; an SQLite adapter for Docker later).
 * Test-only: import it from a *.test.ts file (guard: platform-boundary). It creates its own tables
 * (`contract_*`), so it runs on a database that already has the app's migrations.
 */
export type DbSetup = () => Promise<{ db: Db; dispose(): Promise<void> }>;

const s = (sql: string, ...params: Statement['params']): Statement => ({ sql, params });

export function describeDbContract(name: string, setup: DbSetup): void {
  describe(`Db contract: ${name}`, () => {
    let db: Db;
    let dispose: () => Promise<void>;

    beforeAll(async () => {
      ({ db, dispose } = await setup());
      await db.batch([
        s('CREATE TABLE IF NOT EXISTS contract_items (id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE, note TEXT)'),
        s('CREATE TABLE IF NOT EXISTS contract_log (id INTEGER PRIMARY KEY, label TEXT NOT NULL)'),
        s(`CREATE TRIGGER IF NOT EXISTS contract_items_log AFTER INSERT ON contract_items
           BEGIN INSERT INTO contract_log (label) VALUES (NEW.label); END`),
        s('DELETE FROM contract_items'),
        s('DELETE FROM contract_log'),
      ]);
    });
    afterAll(() => dispose());

    it('runs a write and reports changes and the last row id', async () => {
      const result = await db.run(s('INSERT INTO contract_items (label, note) VALUES (?, ?)', 'run', null));
      expect(result.changes).toBeGreaterThan(0); // compare with 0: D1 also counts the trigger's insert
      expect(result.lastRowId).toEqual(expect.any(Number));
      expect((await db.run(s('DELETE FROM contract_items WHERE label = ?', 'nothing'))).changes).toBe(0);
    });

    it('reads all rows, the first row, and null for none; null round-trips', async () => {
      await db.run(s('INSERT INTO contract_items (label, note) VALUES (?, ?), (?, ?)', 'read-a', null, 'read-b', 'x'));
      const rows = await db.all<{ label: string; note: string | null }>(s("SELECT label, note FROM contract_items WHERE label LIKE 'read-%' ORDER BY label"));
      expect(rows).toEqual([
        { label: 'read-a', note: null },
        { label: 'read-b', note: 'x' },
      ]);
      expect(await db.first<{ label: string }>(s('SELECT label FROM contract_items WHERE label = ?', 'read-b'))).toEqual({ label: 'read-b' });
      expect(await db.first(s('SELECT label FROM contract_items WHERE label = ?', 'none'))).toBeNull();
    });

    it('batches in order and returns each statement’s rows and changes', async () => {
      const results = await db.batch<{ n: number }>([
        s('INSERT INTO contract_items (label) VALUES (?)', 'batch-1'),
        s('INSERT INTO contract_items (label) VALUES (?)', 'batch-2'),
        s("SELECT count(*) AS n FROM contract_items WHERE label LIKE 'batch-%'"),
      ]);
      expect(results).toHaveLength(3);
      expect(results[0]!.changes).toBeGreaterThan(0);
      expect(results[2]!.rows).toEqual([{ n: 2 }]);
    });

    it('rolls back the whole batch when a statement fails', async () => {
      await expect(
        db.batch([
          s('INSERT INTO contract_items (label) VALUES (?)', 'atomic-1'),
          s('INSERT INTO contract_items (label) VALUES (?)', 'atomic-1'), // UNIQUE violation
        ]),
      ).rejects.toThrow();
      expect(await db.first(s('SELECT label FROM contract_items WHERE label = ?', 'atomic-1'))).toBeNull();
      expect(await db.first(s('SELECT label FROM contract_log WHERE label = ?', 'atomic-1'))).toBeNull();
    });

    it('treats an empty batch as nothing to do', async () => {
      expect(await db.batch([])).toEqual([]);
    });
  });
}
