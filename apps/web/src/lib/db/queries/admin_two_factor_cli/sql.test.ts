import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { hex64, isoTime, listStatements, resetStatements, setupStatements, unlockStatements, uuid } from './sql';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });
const ID = 'a'.repeat(64);
const LATER = new Date(Date.now() + 3600_000).toISOString();
const NOW = new Date().toISOString();

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

/** As wrangler runs `--command`: each statement on its own, no parameters. */
async function exec(statements: string[]) {
  const out = [];
  for (const sql of statements) out.push(await all(statement(sql), opts()));
  return out;
}

const count = async (table: string) => (await first<{ n: number }>(statement(`SELECT count(*) AS n FROM ${table}`), opts()))?.n ?? 0;

describe('the builders refuse anything but checked values', () => {
  it.each([
    ['hex64', hex64, ID, ["x'; DROP TABLE admin_sessions; --", 'A'.repeat(64), 'a'.repeat(63)]],
    ['uuid', uuid, '00000000-0000-4000-8000-000000000001', ["'", 'not-a-uuid']],
    ['isoTime', isoTime, '2026-11-12T10:00:00.000Z', ["2026-11-12' OR 1=1", '2026-11-12', '2026-11-12T10:00:00Z']],
  ])('%s', (_name, fn, good, bad) => {
    expect(fn(good)).toBe(`'${good}'`);
    for (const value of bad) expect(() => fn(value)).toThrow(/not a valid/);
  });

  it('no statement carries a placeholder or a stray quote', () => {
    const all = [
      ...setupStatements({ setupCodeId: ID, expiresAt: LATER }),
      ...resetStatements({ auditId: '00000000-0000-4000-8000-000000000001', setupCodeId: ID, expiresAt: LATER }),
      ...unlockStatements(),
      ...listStatements({ now: NOW, dayStart: '2026-11-12T00:00:00.000Z' }),
    ];
    for (const sql of all) {
      expect(sql).not.toContain('?');
      expect(sql).not.toContain(';');
      expect((sql.match(/'/g) ?? []).length % 2).toBe(0);
    }
  });
});

describe('on a test D1', () => {
  it('setup stores the code and reads it back; replaces an older code and enroll challenges', async () => {
    await run(statement("INSERT INTO admin_setup_codes (id, expires_at) VALUES (?, ?)", ['b'.repeat(64), LATER]), opts());
    await run(statement("INSERT INTO admin_mfa_challenges (id, kind, password_version, expires_at) VALUES ('c', 'enroll', 'pv', ?)", [LATER]), opts());
    const out = await exec(setupStatements({ setupCodeId: ID, expiresAt: LATER }));
    expect(out.at(-1)).toEqual([{ stored: 1 }]);
    expect(await all(statement('SELECT id FROM admin_setup_codes'), opts())).toEqual([{ id: ID }]);
    expect(await count('admin_mfa_challenges')).toBe(0);
  });

  it('setup stores nothing when an authenticator exists', async () => {
    await run(statement("INSERT INTO admin_authenticators (id, label, secret_enc, last_step) VALUES ('a', 'Phone', 'v1:x', 1)"), opts());
    const out = await exec(setupStatements({ setupCodeId: ID, expiresAt: LATER }));
    expect(out.at(-1)).toEqual([{ stored: 0 }]);
    expect(await count('admin_setup_codes')).toBe(0);
  });

  it('reset leaves no authenticator, recovery code, challenge or session, audits it, and stores a setup code', async () => {
    await run(statement("INSERT INTO admin_authenticators (id, label, secret_enc, last_step) VALUES ('a', 'Phone', 'v1:x', 1)"), opts());
    await run(statement('INSERT INTO admin_recovery_codes (id) VALUES (?)', ['r'.repeat(64)]), opts());
    await run(statement("INSERT INTO admin_mfa_challenges (id, kind, password_version, expires_at) VALUES ('c', 'login', 'pv', ?)", [LATER]), opts());
    await run(
      statement("INSERT INTO admin_sessions (id, password_version, second_factor, authenticator_id, expires_at) VALUES (?, 'pv', 'authenticator', 'a', ?)", ['s'.repeat(64), LATER]),
      opts(),
    );
    const out = await exec(resetStatements({ auditId: '00000000-0000-4000-8000-000000000001', setupCodeId: ID, expiresAt: LATER }));
    expect(out.at(-1)).toEqual([{ stored: 1 }]);
    for (const table of ['admin_authenticators', 'admin_recovery_codes', 'admin_mfa_challenges', 'admin_sessions']) expect(await count(table)).toBe(0);
    expect(await first(statement('SELECT action, entity FROM audit_log'), opts())).toEqual({ action: 'delete', entity: 'two_factor' });
  });

  it('unlock clears the login:% rows only', async () => {
    for (const bucket of ['login:code:fail', 'login:ip:x', 'login:global', 'contact:ip:y']) {
      await run(statement("INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, '2026-11-12T00:00:00.000Z', 3)", [bucket]), opts());
    }
    await exec(unlockStatements());
    expect(await all(statement('SELECT bucket FROM rate_limits'), opts())).toEqual([{ bucket: 'contact:ip:y' }]);
  });

  it('list runs on an empty database', async () => {
    const out = await exec(listStatements({ now: NOW, dayStart: `${NOW.slice(0, 10)}T00:00:00.000Z` }));
    expect(out).toEqual([[], [{ total: 0, unused: 0 }], [], [{ expires_at: null }], [{ failures: 0 }]]);
  });
});
