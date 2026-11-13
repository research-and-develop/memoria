import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { conditionalAuditStatement } from '../audit_log';

import { endSignInsAfterPasswordStatements, getAdminAccountRow, saveAdminAccountStatement } from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const HASH_A = 'pbkdf2-sha256$20000$aaaa$aaaa';
const HASH_B = 'pbkdf2-sha256$20000$bbbb$bbbb';
const NOW = '2026-11-13T10:00:00.000Z';

function save(input: { email?: string; passwordHash?: string; setBy?: 'studio' | 'cli' | 'env'; expectedHash?: string }) {
  return saveAdminAccountStatement({
    email: input.email ?? 'owner@example.com',
    passwordHash: input.passwordHash ?? HASH_A,
    setBy: input.setBy ?? 'studio',
    expectedHash: input.expectedHash ?? HASH_A,
    now: NOW,
  });
}

const auditCount = async () => (await first<{ n: number }>(statement('SELECT count(*) AS n FROM audit_log'), opts()))?.n ?? 0;

describe('admin_account queries', () => {
  it('is empty until saved; the first save inserts', async () => {
    expect(await getAdminAccountRow(opts())).toBeNull();
    await run(save({ setBy: 'env' }), opts());
    expect(await getAdminAccountRow(opts())).toEqual({ email: 'owner@example.com', password_hash: HASH_A, set_by: 'env', updated_at: NOW });
  });

  it('stores the email lower-cased and the hash trimmed', async () => {
    await run(save({ email: ' Owner@Example.COM ', passwordHash: `  ${HASH_A}\n` }), opts());
    expect(await getAdminAccountRow(opts())).toMatchObject({ email: 'owner@example.com', password_hash: HASH_A });
  });

  it('updates only while the stored hash is the expected one', async () => {
    await run(save({}), opts());
    expect((await run(save({ passwordHash: HASH_B, expectedHash: HASH_A }), opts())).changes).toBeGreaterThan(0);
    expect((await getAdminAccountRow(opts()))?.password_hash).toBe(HASH_B);

    const stale = await batch(
      [save({ passwordHash: HASH_A, expectedHash: HASH_A }), conditionalAuditStatement({ action: 'update', entity: 'admin_account' }, 'changes() > 0', [])],
      opts(),
    );
    expect(stale[0]?.changes).toBe(0);
    expect((await getAdminAccountRow(opts()))?.password_hash).toBe(HASH_B);
    expect(await auditCount()).toBe(0);
  });

  it('ends sessions and challenges only when the new hash took effect', async () => {
    await run(save({}), opts());
    await run(
      statement("INSERT INTO admin_sessions (id, password_version, second_factor, authenticator_id, expires_at) VALUES (?, 'v', 'recovery_code', NULL, '2099-01-01T00:00:00.000Z')", ['a'.repeat(64)]),
      opts(),
    );
    const sessions = async () => (await first<{ n: number }>(statement('SELECT count(*) AS n FROM admin_sessions'), opts()))?.n;

    await batch([save({ passwordHash: HASH_B, expectedHash: 'pbkdf2-sha256$stale' }), ...endSignInsAfterPasswordStatements(HASH_B)], opts());
    expect(await sessions()).toBe(1);

    await batch([save({ passwordHash: HASH_B, expectedHash: HASH_A }), ...endSignInsAfterPasswordStatements(HASH_B)], opts());
    expect(await sessions()).toBe(0);
  });

  it.each([
    ['another id', "INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (2, 'owner@example.com', 'pbkdf2-sha256$x', 'cli')"],
    ['an upper-case email', "INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, 'Owner@example.com', 'pbkdf2-sha256$x', 'cli')"],
    ['a malformed email', "INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, 'owner-example', 'pbkdf2-sha256$x', 'cli')"],
    ['a hash of another scheme', "INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, 'owner@example.com', 'bcrypt$x', 'cli')"],
    ['an unknown set_by', "INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, 'owner@example.com', 'pbkdf2-sha256$x', 'someone')"],
  ])('the schema refuses %s', async (_name, sql) => {
    await expect(run(statement(sql), opts())).rejects.toThrow(/CHECK constraint failed/);
  });
});
