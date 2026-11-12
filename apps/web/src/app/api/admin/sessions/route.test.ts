import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, first, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getRecoveryCodeStatus } from '@/lib/db/queries/admin_recovery_codes';
import { adminCookie, jsonRequest, params, sessionIdOf } from '@/lib/testing/routeHarness';
import { seedAuthenticator, seedRecoveryCodes, TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { DELETE: signOut } = await import('./[id]/route');
const { POST: signOutOthers } = await import('./sign-out-others/route');
const { POST: regenerate } = await import('../recovery-codes/route');
const { POST: acknowledge } = await import('../recovery-codes/acknowledge/route');
const { POST: enroll } = await import('../authenticators/enrollments/route');

let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(() => {
  useTestPlatform({
    db: testDb.db,
    env: { ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 },
  });
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const sessionIds = async () => (await all<{ id: string }>(statement('SELECT id FROM admin_sessions'), db())).map((r) => r.id).sort();
const del = async (cookie: string, id: string) =>
  signOut(jsonRequest(`/api/admin/sessions/${id}`, undefined, { method: 'DELETE', cookie }), params({ id }));

describe('signing out devices', () => {
  it('this device: no code needed, the cookie is cleared', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await del(cookie, await sessionIdOf(cookie));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(await sessionIds()).toEqual([]);
  });

  it('another device: needs a recent code; its unfinished setups go with it', async () => {
    await seedAuthenticator(testDb.db);
    const other = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await enroll(jsonRequest('/api/admin/authenticators/enrollments', {}, { cookie: other }));
    const otherId = await sessionIdOf(other);

    const plain = await adminCookie(passwordHash, testDb.db);
    const refused = await del(plain, otherId);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ errorCode: 'SECOND_FACTOR_REQUIRED' });

    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await del(cookie, otherId);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await sessionIds()).not.toContain(otherId);
    expect(await all(statement('SELECT id FROM admin_mfa_challenges'), db())).toEqual([]);
    expect((await del(cookie, otherId)).status).toBe(404);
    expect((await del(cookie, 'nope')).status).toBe(404);
  });

  it('sign out all other devices (confirm) keeps this one', async () => {
    await adminCookie(passwordHash, testDb.db);
    await adminCookie(passwordHash, testDb.db);
    const plain = await adminCookie(passwordHash, testDb.db);
    expect((await signOutOthers(jsonRequest('/api/admin/sessions/sign-out-others', {}, { cookie: plain }))).status).toBe(403);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await signOutOthers(jsonRequest('/api/admin/sessions/sign-out-others', {}, { cookie }));
    expect(res.status).toBe(200);
    expect(await sessionIds()).toEqual([await sessionIdOf(cookie)]);
  });
});

describe('recovery codes', () => {
  it('new codes (confirm) replace the old ones and end the sessions that used an old one (not this one)', async () => {
    await seedRecoveryCodes(testDb.db, ['abcde-fgh23']);
    const viaRecovery = await adminCookie(passwordHash, testDb.db, { secondFactor: 'recovery_code' });
    const plain = await adminCookie(passwordHash, testDb.db, { secondFactor: 'recovery_code' });
    expect((await regenerate(jsonRequest('/api/admin/recovery-codes', {}, { cookie: plain }))).status).toBe(403);

    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true, secondFactor: 'recovery_code' });
    const res = await regenerate(jsonRequest('/api/admin/recovery-codes', {}, { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { recoveryCodes: string[] } };
    expect(data.recoveryCodes).toHaveLength(10);
    expect(await getRecoveryCodeStatus(db())).toEqual({ total: 10, unused: 10, acknowledged: false });
    expect(await sessionIds()).toEqual([await sessionIdOf(cookie)]);
    expect(await sessionIds()).not.toContain(await sessionIdOf(viaRecovery));
    expect(await first(statement("SELECT entity FROM audit_log WHERE entity = 'recovery_codes'"), db())).not.toBeNull();
  });

  it('"I have saved these codes" acknowledges the set', async () => {
    await seedRecoveryCodes(testDb.db, ['abcde-fgh23', 'zzzzz-yyyyy']);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await acknowledge(jsonRequest('/api/admin/recovery-codes/acknowledge', {}, { cookie }))).status).toBe(200);
    expect((await getRecoveryCodeStatus(db())).acknowledged).toBe(true);
    expect((await acknowledge(jsonRequest('/api/admin/recovery-codes/acknowledge', {}, {}))).status).toBe(401);
  });
});
