import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { challengeCookieName } from '@/lib/auth/challenge';
import { hashPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { CODE_FAILURE_RULE } from '@/lib/auth/secondFactor';
import { listLiveAdminSessions } from '@/lib/db/queries/admin_sessions';
import { windowStart } from '@/lib/security/rateLimit';
import { adminCookie, atFixedTime, jsonRequest } from '@/lib/testing/routeHarness';
import { seedAuthenticator, seedSetupCode, TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const turnstile = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; reason?: string } }));
vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => turnstile.result) }));

const { POST: login, DELETE: startOver } = await import('./route');
const { POST: logout } = await import('../logout/route');

const EMAIL = 'admin@example.com';
const PASSWORD = 'a-long-test-password-123';
let testDb: TestDb;
let passwordHash: string;
/** The env the test platform parses on every config() call: a test may change it. */
let env: Record<string, string>;

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword(PASSWORD, 1_000);
});
beforeEach(() => {
  env = { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: passwordHash, TURNSTILE_SECRET_KEY: 'secret', HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 };
  useTestPlatform({ db: testDb.db, env });
  turnstile.result = { ok: true };
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const credentials = (overrides: Record<string, unknown> = {}) => ({ email: EMAIL, password: PASSWORD, turnstileToken: 't', ...overrides });
const setCookies = (res: Response) => res.headers.getSetCookie();
const challenges = () => all<{ kind: string }>(statement('SELECT kind FROM admin_mfa_challenges'), { db: testDb.db });
const sessions = () => listLiveAdminSessions(new Date().toISOString(), { db: testDb.db });

describe('POST /api/admin/login (step 1: the password)', () => {
  it('with an authenticator: a login challenge in its own cookie, no session, next = code', async () => {
    await seedAuthenticator(testDb.db);
    const res = await login(jsonRequest('/api/admin/login', credentials({ email: ' Admin@Example.COM ' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { next: 'code' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(new RegExp(`^${challengeCookieName(false)}=[A-Za-z0-9_-]{43};`));
    expect(cookies[0]).toMatch(/HttpOnly/i);
    expect(cookies[0]).toMatch(/Max-Age=600/i);
    expect(cookies[0]).toMatch(/SameSite=lax/i);
    expect(await challenges()).toEqual([{ kind: 'login' }]);
    expect(await sessions()).toEqual([]);
  });

  it('with no authenticator but a live setup code: an enroll challenge, next = setup', async () => {
    await seedSetupCode(testDb.db);
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(await res.json()).toEqual({ data: { next: 'setup' } });
    expect(await challenges()).toEqual([{ kind: 'enroll' }]);
  });

  it('with neither: 503 TWO_FACTOR_SETUP_REQUIRED, naming the command', async () => {
    await seedSetupCode(testDb.db, 'ABCDEFGHIJKLMNOPQRST', new Date(Date.now() - 1000));
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { errorCode: string; details: { message: string } };
    expect(body.errorCode).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect(body.details.message).toContain('npm run admin:mfa -- setup');
    expect(await challenges()).toEqual([]);
  });

  it('without a usable TOTP_ENCRYPTION_KEY: 503 TWO_FACTOR_NOT_CONFIGURED', async () => {
    await seedAuthenticator(testDb.db);
    env.TOTP_ENCRYPTION_KEY = 'too-short';
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ errorCode: 'TWO_FACTOR_NOT_CONFIGURED' });
  });

  it('marks the cookie Secure and __Host- over HTTPS', async () => {
    await seedAuthenticator(testDb.db);
    const res = await login(jsonRequest('/api/admin/login', credentials(), { headers: { 'x-forwarded-proto': 'https' } }));
    expect(setCookies(res)[0]).toMatch(new RegExp(`^${challengeCookieName(true)}=.*Secure`, 'i'));
  });

  it.each([
    ['a wrong password', credentials({ password: 'wrong' })],
    ['an unknown email', credentials({ email: 'someone@else.com' })],
  ])('refuses %s with one generic message and no challenge', async (_label, body) => {
    await seedAuthenticator(testDb.db);
    const res = await login(jsonRequest('/api/admin/login', body));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_CREDENTIALS', details: { message: 'Wrong email or password.' } });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await challenges()).toEqual([]);
  });

  it('refuses a failed Turnstile check before looking at the password', async () => {
    turnstile.result = { ok: false, reason: 'rejected' };
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'TURNSTILE_FAILED' });
  });

  it('answers SIGN_IN_LOCKED once 20 codes failed today, before checking the password', async () => {
    await seedAuthenticator(testDb.db);
    const now = new Date();
    await run(
      statement('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)', [
        CODE_FAILURE_RULE.bucket,
        windowStart(now, CODE_FAILURE_RULE.windowSeconds),
        CODE_FAILURE_RULE.limit,
      ]),
      { db: testDb.db },
    );
    turnstile.result = { ok: false, reason: 'rejected' };
    const res = await login(jsonRequest('/api/admin/login', credentials({ password: 'wrong' })));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ errorCode: 'SIGN_IN_LOCKED' });
  });

  it('rate-limits after 10 attempts from one IP', async () => {
    await seedAuthenticator(testDb.db);
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    await atFixedTime(async () => {
      for (let i = 0; i < 10; i++) {
        expect((await login(jsonRequest('/api/admin/login', credentials({ password: 'x' }), { headers }))).status).toBe(401);
      }
      const res = await login(jsonRequest('/api/admin/login', credentials(), { headers }));
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      // Another IP is not affected.
      expect((await login(jsonRequest('/api/admin/login', credentials(), { headers: { 'cf-connecting-ip': '198.51.100.1' } }))).status).toBe(200);
    });
  });

  it('refuses a cross-origin post', async () => {
    const res = await login(jsonRequest('/api/admin/login', credentials(), { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(res.status).toBe(403);
  });

  it('is closed (503) until the admin email and password hash are configured', async () => {
    env.ADMIN_PASSWORD_HASH = '';
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ errorCode: 'ADMIN_NOT_CONFIGURED' });
  });

  it('validates the body', async () => {
    const res = await login(jsonRequest('/api/admin/login', { email: '', password: 'x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { field: 'email' } });
  });
});

describe('DELETE /api/admin/login ("Start over")', () => {
  it('deletes the challenge and clears its cookie', async () => {
    await seedAuthenticator(testDb.db);
    const first = await login(jsonRequest('/api/admin/login', credentials()));
    const cookie = setCookies(first)[0]?.split(';')[0] ?? '';
    const res = await startOver(jsonRequest('/api/admin/login', undefined, { method: 'DELETE', cookie }));
    expect(res.status).toBe(200);
    expect(setCookies(res)[0]).toMatch(/Max-Age=0/i);
    expect(await challenges()).toEqual([]);
  });

  it('works without a challenge, and refuses cross-origin', async () => {
    expect((await startOver(jsonRequest('/api/admin/login', undefined, { method: 'DELETE' }))).status).toBe(200);
    const res = await startOver(jsonRequest('/api/admin/login', undefined, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(res.status).toBe(403);
  });
});

describe('sessions', () => {
  const signIn = () => adminCookie(passwordHash, testDb.db);

  it('the gate accepts a live session', async () => {
    const cookie = await signIn();
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }))).ok).toBe(true);
  });

  it('over HTTPS the gate reads only the __Host- cookie (D2.19)', async () => {
    const cookie = await signIn();
    const gate = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie, headers: { 'x-forwarded-proto': 'https' } }));
    expect(gate.ok).toBe(false);
    const hostCookie = cookie.replace(/^memoria_admin=/, '__Host-memoria_admin=');
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: hostCookie, headers: { 'x-forwarded-proto': 'https' } }))).ok).toBe(true);
  });

  it('a rotated password ends every session', async () => {
    const cookie = await signIn();
    env.ADMIN_PASSWORD_HASH = await hashPassword('a-new-long-password-456', 1_000);
    const gate = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    expect(await sessions()).toEqual([]);
  });

  it('an expired session is refused', async () => {
    const cookie = await signIn();
    await run(statement("UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z'"), { db: testDb.db });
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }))).ok).toBe(false);
  });

  it('the gate refuses a cross-origin write even with a valid session', async () => {
    const cookie = await signIn();
    const gate = await requireAdmin(jsonRequest('/api/admin/x', {}, { cookie, headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(403);
  });

  it('logout ends this session; "everywhere" ends all of them', async () => {
    const a = await signIn();
    const b = await signIn();
    const res = await logout(jsonRequest('/api/admin/logout', {}, { cookie: a }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: a }))).ok).toBe(false);
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: b }))).ok).toBe(true);

    await signIn();
    await logout(jsonRequest('/api/admin/logout', { everywhere: true }, { cookie: b }));
    expect(await sessions()).toEqual([]);
  });
});
