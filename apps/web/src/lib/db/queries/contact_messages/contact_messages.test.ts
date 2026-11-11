import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { createContactMessageStatement, deleteContactMessageStatement, getContactMessage, listContactMessages, markContactMessageReadStatement } from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const input = (name = 'Ada Lovelace') => ({ name, email: 'ada@example.com', message: 'Hello!', consentAt: '2026-01-01T00:00:00.000Z' });

describe('contact_messages queries', () => {
  it('stores a message and reads it back converted (is_read is a boolean)', async () => {
    await createContactMessageStatement('m1', input(), opts()).run();
    expect(await getContactMessage('m1', opts())).toMatchObject({ id: 'm1', name: 'Ada Lovelace', is_read: false });
    await markContactMessageReadStatement('m1', true, opts()).run();
    expect((await getContactMessage('m1', opts()))?.is_read).toBe(true);
  });

  it('lists newest first, one page at a time', async () => {
    for (const id of ['a', 'b', 'c']) {
      await createContactMessageStatement(id, input(id), opts()).run();
      await testDb.db.prepare('UPDATE contact_messages SET created_at = ? WHERE id = ?').bind(`2026-01-0${'abc'.indexOf(id) + 1}T00:00:00.000Z`, id).run();
    }
    expect((await listContactMessages({ limit: 2, offset: 0 }, opts())).map((m) => m.id)).toEqual(['c', 'b']);
    expect((await listContactMessages({ limit: 2, offset: 2 }, opts())).map((m) => m.id)).toEqual(['a']);
  });

  it('enforces the limits in the schema, and a failed batch writes nothing', async () => {
    await expect(
      batch([createContactMessageStatement('ok', input(), opts()), createContactMessageStatement('bad', input('x'.repeat(101)), opts())], opts()),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await listContactMessages({ limit: 10, offset: 0 }, opts())).toEqual([]);
  });

  it('deletes; a missing row is null', async () => {
    await createContactMessageStatement('m1', input(), opts()).run();
    await deleteContactMessageStatement('m1', opts()).run();
    expect(await getContactMessage('m1', opts())).toBeNull();
  });
});
