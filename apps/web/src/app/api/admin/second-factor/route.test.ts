import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { CODE_FAILURE_RULE } from '@/lib/auth/secondFactor';
import { totpStep } from '@/lib/auth/totp';
import { windowStart } from '@/lib/security/rateLimit';
import { adminCookie, jsonRequest, sessionIdOf } from '@/lib/testing/routeHarness';
import { codeFor, seedAuthenticator, seedRecoveryCodes, TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST: confirm } = await import('./route');

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

const post = (cookie: string, body: unknown, headers: Record<string, string> = {}) =>
  confirm(jsonRequest('/api/admin/second-factor', body, { cookie, headers }));
const sessionRow = async (cookie: string) =>
  first<{ verified_until: string | null; code_failures: number }>(
    statement('SELECT verified_until, code_failures FROM admin_sessions WHERE id = ?', [await sessionIdOf(cookie)]),
    db(),
  );
const failuresToday = async () =>
  (await first<{ count: number }>(statement('SELECT count FROM rate_limits WHERE bucket = ?', [CODE_FAILURE_RULE.bucket]), db()))?.count ?? 0;

describe('POST /api/admin/second-factor', () => {
  it('a right code opens the 5-minute window', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await post(cookie, { code: await codeFor(app.secret) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { verifiedUntil: string } };
    const until = Date.parse(data.verifiedUntil) - Date.now();
    expect(until).toBeGreaterThan(4 * 60_000);
    expect(until).toBeLessThanOrEqual(5 * 60_000);
    expect(await sessionRow(cookie)).toMatchObject({ verified_until: data.verifiedUntil, code_failures: 0 });
  });

  it('the sign-in code typed again: CODE_ALREADY_USED, not a failure anywhere (D2.20)', async () => {
    const app = await seedAuthenticator(testDb.db, { lastStep: totpStep(Date.now()) });
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await post(cookie, { code: await codeFor(app.secret) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ errorCode: 'CODE_ALREADY_USED' });
    expect(await sessionRow(cookie)).toMatchObject({ verified_until: null, code_failures: 0 });
    expect(await failuresToday()).toBe(0);
  });

  it('a recovery code opens it too, and is spent', async () => {
    await seedAuthenticator(testDb.db);
    await seedRecoveryCodes(testDb.db, ['abcde-fgh23', 'zzzzz-yyyyy']);
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await post(cookie, { recoveryCode: 'ABCDE FGH23' });
    expect(await res.json()).toMatchObject({ data: { recoveryCodesLeft: 1 } });
    expect((await post(cookie, { recoveryCode: 'abcde-fgh23' })).status).toBe(401);
  });

  it('wrong codes: attempts left 4..1, the fifth ends the session; each counts toward the lockout', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await adminCookie(passwordHash, testDb.db);
    for (let left = 4; left >= 1; left--) {
      expect(await (await post(cookie, { code: '000000' })).json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: left } });
    }
    const last = await post(cookie, { code: '000000' });
    expect(await last.json()).toMatchObject({ errorCode: 'SESSION_ENDED' });
    expect(last.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(await sessionRow(cookie)).toBeNull();
    expect(await failuresToday()).toBe(5);
    expect((await post(cookie, { code: '000000' })).status).toBe(401);
  });

  it('a right code resets the count of wrong ones', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await adminCookie(passwordHash, testDb.db);
    await post(cookie, { code: '000000' });
    await post(cookie, { code: await codeFor(app.secret) });
    expect((await sessionRow(cookie))?.code_failures).toBe(0);
  });

  it('is refused while sign-in is locked', async () => {
    await seedAuthenticator(testDb.db);
    const now = new Date();
    await run(
      statement('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)', [
        CODE_FAILURE_RULE.bucket,
        windowStart(now, CODE_FAILURE_RULE.windowSeconds),
        CODE_FAILURE_RULE.limit,
      ]),
      db(),
    );
    const res = await post(await adminCookie(passwordHash, testDb.db), { code: '000000' });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ errorCode: 'SIGN_IN_LOCKED' });
  });

  it('needs a session, a same-origin request and exactly one kind of code', async () => {
    expect((await post('', { code: '123456' })).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await post(cookie, { code: '123456' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(cookie, { code: '123456', recoveryCode: 'abcde-fgh23' })).status).toBe(400);
  });
});
