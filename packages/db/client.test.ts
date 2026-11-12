import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from '@repo/platform/ports';

import { all, allRows, batch, execute, first, firstRow, getDb, query, queryFirst, run, statement } from './client';
import { createTestDb, useTestDb, type TestDb } from './test-utils';

/**
 * The contract every write relies on: a `batch()` is all-or-nothing, and there
 * is no other transaction. Uses its own throwaway table on a test D1.
 */
let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
  await run(statement('CREATE TABLE batch_probe (label TEXT NOT NULL CONSTRAINT uq_batch_probe_label UNIQUE)'), opts());
});
afterEach(async () => {
  useTestDb(null);
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function labels(): Promise<string[]> {
  const rows = await query<{ label: string }>('SELECT label FROM batch_probe ORDER BY label', [], opts());
  return rows.map((r) => r.label);
}

const insert = (label: string) => statement('INSERT INTO batch_probe (label) VALUES (?)', [label]);

describe('statement', () => {
  it('is plain, frozen data', () => {
    const stmt = statement('SELECT ?', ['a']);
    expect(stmt).toEqual({ sql: 'SELECT ?', params: ['a'] });
    expect(Object.isFrozen(stmt) && Object.isFrozen(stmt.params)).toBe(true);
  });

  it.each([
    ['undefined', [undefined], /parameter 0 is undefined/],
    ['a boolean', ['ok', true], /parameter 1 is boolean/],
    ['an object', [{}], /parameter 0 is object/],
  ])('refuses %s', (_label, params, message) => {
    expect(() => statement('SELECT ?, ?', params as never)).toThrow(message);
  });
});

describe('batch', () => {
  it('commits every statement together', async () => {
    await batch([insert('a'), insert('b')], opts());
    expect(await labels()).toEqual(['a', 'b']);
  });

  it('rolls back the WHOLE batch when a later statement fails', async () => {
    await execute('INSERT INTO batch_probe (label) VALUES (?)', ['taken'], opts());
    await expect(batch([insert('fresh'), insert('taken')], opts())).rejects.toThrow(/UNIQUE constraint failed/);
    // 'fresh' ran first and was rolled back with the failing statement.
    expect(await labels()).toEqual(['taken']);
  });

  it('returns each statement’s rows', async () => {
    const results = await batch<{ label: string }>([insert('r'), statement('SELECT label FROM batch_probe')], opts());
    expect(results.map((r) => r.rows)).toEqual([[], [{ label: 'r' }]]);
  });

  it('is a no-op for an empty list, and needs no database for it', async () => {
    expect(await batch([], opts())).toEqual([]);
    expect(await batch([])).toEqual([]);
  });
});

describe('execute / queryFirst', () => {
  it('reports affected rows, and null for no match', async () => {
    expect((await execute('INSERT INTO batch_probe (label) VALUES (?)', ['x'], opts())).changes).toBe(1);
    expect((await execute('DELETE FROM batch_probe WHERE label = ?', ['nope'], opts())).changes).toBe(0);
    expect(await queryFirst('SELECT label FROM batch_probe WHERE label = ?', ['nope'], opts())).toBeNull();
  });
});

describe('all / first / allRows / firstRow', () => {
  it('read and convert rows of a statement', async () => {
    await batch([insert('m'), insert('n')], opts());
    const select = statement('SELECT label FROM batch_probe ORDER BY label');
    expect(await all(select, opts())).toEqual([{ label: 'm' }, { label: 'n' }]);
    expect(await first(select, opts())).toEqual({ label: 'm' });
    expect(await allRows(select, (r: { label: string }) => r.label.toUpperCase(), opts())).toEqual(['M', 'N']);
    expect(await firstRow(select, (r: { label: string }) => r.label.toUpperCase(), opts())).toBe('M');
    expect(await firstRow(statement('SELECT label FROM batch_probe WHERE 0'), (r: { label: string }) => r.label, opts())).toBeNull();
  });
});

describe('getDb', () => {
  it('prefers an explicit db, then the platform’s (the test db under vitest)', () => {
    const other = {} as Db;
    expect(() => getDb()).toThrow(/no test db/);
    useTestDb(testDb.db);
    expect(getDb()).toBe(testDb.db);
    expect(getDb({ db: other })).toBe(other);
  });
});
