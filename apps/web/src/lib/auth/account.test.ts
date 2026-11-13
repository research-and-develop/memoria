import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { envPasswordStillSet, readAdminAccount } from './account';

let testDb: TestDb;
const HASH = 'pbkdf2-sha256$1000$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA==';
const DB_HASH = 'pbkdf2-sha256$1000$ZGJzYWx0ZGJzYWx0ZGJzYQ==$ZGI=';

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const saveRow = () =>
  run(statement("INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, 'owner@example.com', ?, 'cli')", [DB_HASH]), { db: testDb.db });

describe('readAdminAccount', () => {
  it('uses the env account while there is no row (email lower-cased, hash trimmed)', async () => {
    useTestPlatform({ db: testDb.db, env: { ADMIN_EMAIL: ' Admin@Example.COM ', ADMIN_PASSWORD_HASH: ` ${HASH} ` } });
    expect(await readAdminAccount()).toEqual({ email: 'admin@example.com', passwordHash: HASH, source: 'env', setBy: 'env' });
  });

  it('prefers the row', async () => {
    useTestPlatform({ db: testDb.db, env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: HASH } });
    await saveRow();
    expect(await readAdminAccount()).toEqual({ email: 'owner@example.com', passwordHash: DB_HASH, source: 'database', setBy: 'cli' });
  });

  it('falls back to env again when the row is deleted (documented: remove the env account after install)', async () => {
    useTestPlatform({ db: testDb.db, env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: HASH } });
    await saveRow();
    await run(statement('DELETE FROM admin_account'), { db: testDb.db });
    expect((await readAdminAccount())?.source).toBe('env');
  });

  it.each([
    ['neither', {}],
    ['only the email', { ADMIN_EMAIL: 'admin@example.com' }],
    ['only the hash', { ADMIN_PASSWORD_HASH: HASH }],
  ])('is null with %s', async (_name, env) => {
    useTestPlatform({ db: testDb.db, env });
    expect(await readAdminAccount()).toBeNull();
  });
});

describe('envPasswordStillSet', () => {
  it('says whether ADMIN_PASSWORD_HASH is set', () => {
    useTestPlatform({ env: { ADMIN_PASSWORD_HASH: ' ' } });
    expect(envPasswordStillSet()).toBe(false);
    useTestPlatform({ env: { ADMIN_PASSWORD_HASH: HASH } });
    expect(envPasswordStillSet()).toBe(true);
  });
});
