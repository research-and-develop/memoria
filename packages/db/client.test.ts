import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, execute, getDb, query, queryFirst, statement } from './client';
import { createTestDb, splitSqlStatements, useTestDb, type TestDb } from './test-utils';

/**
 * The contract every write relies on: a `batch()` is all-or-nothing, and there
 * is no other transaction. Uses its own throwaway table on a test D1.
 */
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await testDb.db.exec('CREATE TABLE batch_probe (label TEXT NOT NULL CONSTRAINT uq_batch_probe_label UNIQUE)');
});
afterEach(async () => {
  useTestDb(null);
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function labels(): Promise<string[]> {
  const rows = await query<{ label: string }>('SELECT label FROM batch_probe ORDER BY label', [], { db: testDb.db });
  return rows.map((r) => r.label);
}

describe('batch', () => {
  it('commits every statement together', async () => {
    const opts = { db: testDb.db };
    await batch(
      [
        statement('INSERT INTO batch_probe (label) VALUES (?)', ['a'], opts),
        statement('INSERT INTO batch_probe (label) VALUES (?)', ['b'], opts),
      ],
      opts,
    );
    expect(await labels()).toEqual(['a', 'b']);
  });

  it('rolls back the WHOLE batch when a later statement fails', async () => {
    const opts = { db: testDb.db };
    await execute('INSERT INTO batch_probe (label) VALUES (?)', ['taken'], opts);
    await expect(
      batch(
        [
          statement('INSERT INTO batch_probe (label) VALUES (?)', ['fresh'], opts),
          statement('INSERT INTO batch_probe (label) VALUES (?)', ['taken'], opts),
        ],
        opts,
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    // 'fresh' ran first and was rolled back with the failing statement.
    expect(await labels()).toEqual(['taken']);
  });

  it('is a no-op for an empty list', async () => {
    expect(await batch([], { db: testDb.db })).toEqual([]);
  });
});

describe('execute / queryFirst', () => {
  it('reports affected rows, and null for no match', async () => {
    const opts = { db: testDb.db };
    expect((await execute('INSERT INTO batch_probe (label) VALUES (?)', ['x'], opts)).changes).toBe(1);
    expect((await execute('DELETE FROM batch_probe WHERE label = ?', ['nope'], opts)).changes).toBe(0);
    expect(await queryFirst('SELECT label FROM batch_probe WHERE label = ?', ['nope'], opts)).toBeNull();
  });
});

describe('getDb', () => {
  it('prefers an explicit db, then the test override', () => {
    const other = {} as D1Database;
    useTestDb(testDb.db);
    expect(getDb()).toBe(testDb.db);
    expect(getDb({ db: other })).toBe(other);
  });
});

describe('splitSqlStatements', () => {
  it.each([
    ['one statement', 'CREATE TABLE a (x TEXT);', ['CREATE TABLE a (x TEXT);']],
    ['comments dropped', '-- note\nCREATE TABLE a (x TEXT); -- trailing\n', ['CREATE TABLE a (x TEXT);']],
    ['multi-line statements', 'CREATE TABLE a (\n  x TEXT\n);\nCREATE INDEX ix_a ON a (x);', ['CREATE TABLE a (\n  x TEXT\n);', 'CREATE INDEX ix_a ON a (x);']],
    [
      'a trigger body stays whole',
      'CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET x = 1;\n  UPDATE a SET x = 2;\nEND;\nSELECT 1;',
      ['CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET x = 1;\n  UPDATE a SET x = 2;\nEND;', 'SELECT 1;'],
    ],
  ])('%s', (_label, input, expected) => {
    expect(splitSqlStatements(input)).toEqual(expected);
  });
});
