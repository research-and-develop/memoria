import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { pendingSecretAad } from '@/lib/auth/twoFactorKeys';
import { jsonRequest } from '@/lib/testing/routeHarness';
import { seedAuthenticator, seedSetupCode, TEST_TOTP_KEY_B64, testKeys } from '@/lib/testing/twoFactorHarness';

vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true })) }));

const { POST: login } = await import('../route');
const { POST: setup } = await import('./route');

const EMAIL = 'admin@example.com';
const PASSWORD = 'a-long-test-password-123';
const SETUP = 'ABCDEFGHIJKLMNOPQRST';
let testDb: TestDb;
let passwordHash: string;
let env: Record<string, string>;

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword(PASSWORD, 1_000);
});
beforeEach(() => {
  env = { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: passwordHash, TURNSTILE_SECRET_KEY: 'secret', HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 };
  useTestPlatform({ db: testDb.db, env });
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

type Challenge = { id: string; kind: string; setup_code_id: string | null; pending_secret_enc: string | null; attempts: number };
const challenge = () => first<Challenge>(statement('SELECT id, kind, setup_code_id, pending_secret_enc, attempts FROM admin_mfa_challenges'), { db: testDb.db });

async function passwordStep(): Promise<string> {
  const res = await login(jsonRequest('/api/admin/login', { email: EMAIL, password: PASSWORD, turnstileToken: 't' }));
  expect(await res.json()).toEqual({ data: { next: 'setup' } });
  return res.headers.getSetCookie()[0]?.split(';')[0] ?? '';
}

const post = (cookie: string, setupCode: unknown, headers: Record<string, string> = {}) =>
  setup(jsonRequest('/api/admin/login/setup', { setupCode }, { cookie, headers }));

describe('POST /api/admin/login/setup', () => {
  it('a right setup code (any grouping, any case) stores a new secret for the app on the challenge', async () => {
    await seedSetupCode(testDb.db, SETUP);
    const cookie = await passwordStep();
    const res = await post(cookie, 'abcd-efgh ijkl-mnop-qrst');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { next: 'enroll' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const row = await challenge();
    expect(row).toMatchObject({ kind: 'enroll', attempts: 1 });
    expect(row?.setup_code_id).toMatch(/^[0-9a-f]{64}$/);
    const secret = await (await testKeys()).decryptSecret(row?.pending_secret_enc ?? '', pendingSecretAad(row?.id ?? ''));
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // The setup code is not spent yet: only enrolment spends it.
    expect(await first(statement('SELECT 1 AS one FROM admin_setup_codes'), { db: testDb.db })).not.toBeNull();
  });

  it('a wrong code counts an attempt and a lockout failure; the fifth ends the sign-in', async () => {
    await seedSetupCode(testDb.db, SETUP);
    const cookie = await passwordStep();
    for (let left = 4; left >= 1; left--) {
      const res = await post(cookie, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: left } });
    }
    const last = await post(cookie, 'not even a code');
    expect(await last.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: 0 } });
    expect(last.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);
    expect(await challenge()).toBeNull();
    const failures = await first<{ count: number }>(statement("SELECT count FROM rate_limits WHERE bucket = 'login:code:fail'"), { db: testDb.db });
    expect(failures?.count).toBe(5);
    expect((await post(cookie, SETUP)).status).toBe(401);
  });

  it('an expired setup code does not work', async () => {
    await seedSetupCode(testDb.db, SETUP, new Date(Date.now() + 3600_000));
    const cookie = await passwordStep();
    await run(statement("UPDATE admin_setup_codes SET expires_at = '2000-01-01T00:00:00.000Z'"), { db: testDb.db });
    const res = await post(cookie, SETUP);
    expect(await res.json()).toMatchObject({ errorCode: 'CODE_INVALID' });
    expect((await challenge())?.setup_code_id).toBeNull();
  });

  it('an authenticator added meanwhile (another device): 409 ALREADY_ENROLLED', async () => {
    await seedSetupCode(testDb.db, SETUP);
    const cookie = await passwordStep();
    await seedAuthenticator(testDb.db);
    const res = await post(cookie, SETUP);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ errorCode: 'ALREADY_ENROLLED' });
    expect(await challenge()).toBeNull();
  });

  it('without a challenge cookie: 401 CHALLENGE_EXPIRED', async () => {
    const res = await post('', SETUP);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
  });

  it('validates the body and refuses cross-origin', async () => {
    expect((await post('', '')).status).toBe(400);
    expect((await post('', SETUP, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});
