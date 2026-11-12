import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { CODE_FAILURE_RULE } from '@/lib/auth/secondFactor';
import { sessionCookieName } from '@/lib/auth/session';
import { listRecentAudit } from '@/lib/db/queries/audit_log';
import { listLiveAdminSessions } from '@/lib/db/queries/admin_sessions';
import { windowStart } from '@/lib/security/rateLimit';
import { jsonRequest } from '@/lib/testing/routeHarness';
import { codeFor, seedAuthenticator, seedRecoveryCodes, seedSetupCode, TEST_TOTP_KEY_B64, testKeys } from '@/lib/testing/twoFactorHarness';
import { pendingSecretAad } from '@/lib/auth/twoFactorKeys';

vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true })) }));

const { POST: login } = await import('../route');
const { POST: setup } = await import('../setup/route');
const { POST: verify } = await import('./route');

const EMAIL = 'admin@example.com';
const PASSWORD = 'a-long-test-password-123';
const SETUP = 'ABCDEFGHIJKLMNOPQRST';
let testDb: TestDb;
let passwordHash: string;
let env: Record<string, string>;
const db = () => ({ db: testDb.db });

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

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
const firstCookie = (res: Response) => res.headers.getSetCookie()[0]?.split(';')[0] ?? '';

/** Step 1: the password. Returns the challenge cookie (Cookie header value). */
async function passwordStep(headers: Record<string, string> = {}): Promise<string> {
  const res = await login(jsonRequest('/api/admin/login', { email: EMAIL, password: PASSWORD, turnstileToken: 't' }, { headers }));
  expect(res.status).toBe(200);
  return firstCookie(res);
}

/** Up to the QR code: password, setup code. Returns the cookie and the new app's secret. */
async function enrolStep(): Promise<{ cookie: string; secret: string }> {
  await seedSetupCode(testDb.db, SETUP);
  const cookie = await passwordStep();
  expect((await setup(jsonRequest('/api/admin/login/setup', { setupCode: SETUP }, { cookie }))).status).toBe(200);
  const row = await first<{ id: string; pending_secret_enc: string }>(statement('SELECT id, pending_secret_enc FROM admin_mfa_challenges'), db());
  const secret = await (await testKeys()).decryptSecret(row?.pending_secret_enc ?? '', pendingSecretAad(row?.id ?? ''));
  return { cookie, secret: secret ?? '' };
}

const post = (cookie: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  verify(jsonRequest('/api/admin/login/verify', body, { cookie, headers }));
const failuresToday = async () =>
  (await first<{ count: number }>(statement('SELECT count FROM rate_limits WHERE bucket = ?', [CODE_FAILURE_RULE.bucket]), db()))?.count ?? 0;
const challengeCount = async () => (await all(statement('SELECT id FROM admin_mfa_challenges'), db())).length;

describe('POST /api/admin/login/verify: a code from an authenticator app', () => {
  it('a code from either of two apps signs in: session cookie, challenge cleared, audited', async () => {
    await seedAuthenticator(testDb.db, { label: 'Phone' });
    const tablet = await seedAuthenticator(testDb.db, { label: 'Tablet' });
    const cookie = await passwordStep();
    const res = await post(cookie, { code: await codeFor(tablet.secret) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: { expiresAt: string } };
    expect(Date.parse(body.data.expiresAt)).toBeGreaterThan(Date.now() + 13 * 24 * 3600_000);
    const session = cookieOf(res, sessionCookieName(false));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(new RegExp(`Max-Age=${90 * 24 * 3600}`));
    expect(cookieOf(res, 'memoria_admin_mfa')).toMatch(/Max-Age=0/i);
    expect(await challengeCount()).toBe(0);

    const [row] = await listLiveAdminSessions(new Date().toISOString(), db());
    expect(row).toMatchObject({ second_factor: 'authenticator', authenticator_id: tablet.id, user_agent: 'vitest', verified_until: null });
    expect((await listRecentAudit(5, db()))[0]).toMatchObject({ action: 'login', entity: 'session', summary: 'Signed in with an authenticator app' });
    const gate = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: session?.split(';')[0] ?? '' }));
    expect(gate.ok).toBe(true);
  });

  it.each([-1, 1])('accepts a code %i step away', async (drift) => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    expect((await post(cookie, { code: await codeFor(app.secret, Date.now(), drift) })).status).toBe(200);
  });

  it('records the country from CF-IPCountry', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    await post(cookie, { code: await codeFor(app.secret) }, { 'cf-ipcountry': 'BG' });
    expect((await listLiveAdminSessions(new Date().toISOString(), db()))[0]?.country).toBe('BG');
  });

  it('a code already used answers CODE_ALREADY_USED and is not a failure (D2.20)', async () => {
    const app = await seedAuthenticator(testDb.db);
    const code = await codeFor(app.secret);
    expect((await post(await passwordStep(), { code })).status).toBe(200);
    const res = await post(await passwordStep(), { code });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ errorCode: 'CODE_ALREADY_USED', details: { attemptsLeft: 4 } });
    expect(await failuresToday()).toBe(0);
  });

  it('a wrong code: attempts left 4..1, the fifth ends the sign-in; each is a failure', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    for (let left = 4; left >= 1; left--) {
      const res = await post(cookie, { code: '000000' });
      expect(await res.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: left } });
    }
    const last = await post(cookie, { code: '12' });
    const body = (await last.json()) as { details: { attemptsLeft: number; message: string } };
    expect(body.details).toMatchObject({ attemptsLeft: 0, message: 'That code did not work. Enter your password again.' });
    expect(cookieOf(last, 'memoria_admin_mfa')).toMatch(/Max-Age=0/i);
    expect(await challengeCount()).toBe(0);
    expect(await failuresToday()).toBe(5);
    expect(await post(cookie, { code: '000000' }).then((r) => r.json())).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
  });

  it('the messages warn about the phone clock after a few tries', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    const messages: string[] = [];
    for (let i = 0; i < 4; i++) messages.push(((await (await post(cookie, { code: '000000' })).json()) as { details: { message: string } }).details.message);
    expect(messages[0]).toBe('That code did not work. 4 tries left.');
    expect(messages[2]).toContain('date and time automatically');
    expect(messages[3]).toContain('Last try');
  });

  it('an expired challenge, a changed password or a CLI reset in between: CHALLENGE_EXPIRED', async () => {
    const app = await seedAuthenticator(testDb.db);
    let cookie = await passwordStep();
    await run(statement("UPDATE admin_mfa_challenges SET expires_at = '2000-01-01T00:00:00.000Z'"), db());
    expect(await (await post(cookie, { code: await codeFor(app.secret) })).json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });

    cookie = await passwordStep();
    env.ADMIN_PASSWORD_HASH = await hashPassword('another-long-password-9', 1_000);
    expect(await (await post(cookie, { code: await codeFor(app.secret) })).json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
    env.ADMIN_PASSWORD_HASH = passwordHash;

    cookie = await passwordStep();
    await run(statement('DELETE FROM admin_authenticators'), db());
    const res = await post(cookie, { code: await codeFor(app.secret) });
    expect(await res.json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
    expect(await challengeCount()).toBe(0);
    expect(await listLiveAdminSessions(new Date().toISOString(), db())).toEqual([]);
  });

  it('a changed TOTP_ENCRYPTION_KEY: 503 TWO_FACTOR_NOT_CONFIGURED', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    env.TOTP_ENCRYPTION_KEY = btoa('x'.repeat(32));
    const res = await post(cookie, { code: await codeFor(app.secret) });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ errorCode: 'TWO_FACTOR_NOT_CONFIGURED' });
  });

  it('after 20 failures today sign-in locks: audited once, refused before the code is checked', async () => {
    const app = await seedAuthenticator(testDb.db);
    const now = new Date();
    await run(
      statement('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)', [
        CODE_FAILURE_RULE.bucket,
        windowStart(now, CODE_FAILURE_RULE.windowSeconds),
        CODE_FAILURE_RULE.limit - 1,
      ]),
      db(),
    );
    const cookie = await passwordStep();
    expect(await (await post(cookie, { code: '000000' })).json()).toMatchObject({ errorCode: 'CODE_INVALID' });
    const res = await post(cookie, { code: await codeFor(app.secret) });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ errorCode: 'SIGN_IN_LOCKED' });
    const locks = (await listRecentAudit(10, db())).filter((a) => a.entity === 'two_factor');
    expect(locks).toHaveLength(1);
    // Step 1 is locked too.
    const again = await login(jsonRequest('/api/admin/login', { email: EMAIL, password: PASSWORD, turnstileToken: 't' }));
    expect(again.status).toBe(429);
  });

  it('only the __Host- challenge cookie counts over HTTPS', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    const https = { 'x-forwarded-proto': 'https' };
    expect(await (await post(cookie, { code: await codeFor(app.secret) }, https)).json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
    const secureCookie = await passwordStep(https);
    expect(secureCookie.startsWith('__Host-memoria_admin_mfa=')).toBe(true);
    const res = await post(secureCookie, { code: await codeFor(app.secret) }, https);
    expect(res.status).toBe(200);
    expect(cookieOf(res, '__Host-memoria_admin')).toMatch(/Secure/i);
  });

  it('refuses both kinds of code at once, neither, and a cross-origin post', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await passwordStep();
    expect((await post(cookie, { code: '123456', recoveryCode: 'abcde-fgh23' })).status).toBe(400);
    expect((await post(cookie, {})).status).toBe(400);
    expect((await post(cookie, { code: '123456' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

describe('POST /api/admin/login/verify: a recovery code', () => {
  it('signs in once, says how many are left, and is spent', async () => {
    await seedAuthenticator(testDb.db);
    await seedRecoveryCodes(testDb.db, ['abcde-fgh23', 'zzzzz-yyyyy']);
    const res = await post(await passwordStep(), { recoveryCode: ' ABCDE FGH23 ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { recoveryCodesLeft: 1 } });
    expect((await listLiveAdminSessions(new Date().toISOString(), db()))[0]).toMatchObject({ second_factor: 'recovery_code', authenticator_id: null });
    expect((await listRecentAudit(5, db()))[0]).toMatchObject({ summary: 'Signed in with a recovery code' });

    const again = await post(await passwordStep(), { recoveryCode: 'abcde-fgh23' });
    expect(await again.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: 4 } });
    expect(await failuresToday()).toBe(1);
  });
});

describe('POST /api/admin/login/verify: first enrolment', () => {
  it('creates the app, 10 recovery codes and a session; spends the setup code; returns the codes once', async () => {
    const { cookie, secret } = await enrolStep();
    const code = await codeFor(secret);
    const res = await post(cookie, { code, label: '  My   iPhone ' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { recoveryCodes: string[] } };
    expect(body.data.recoveryCodes).toHaveLength(10);
    for (const c of body.data.recoveryCodes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(cookieOf(res, sessionCookieName(false))).not.toBeNull();

    const apps = await all<{ label: string; secret_enc: string; last_used_at: string | null }>(
      statement('SELECT label, secret_enc, last_used_at FROM admin_authenticators'),
      db(),
    );
    expect(apps).toEqual([{ label: 'My iPhone', secret_enc: expect.stringMatching(/^v1:/), last_used_at: expect.stringMatching(/^\d{4}-/) }]);
    expect(apps[0]?.secret_enc).not.toContain(secret);
    expect(await all(statement('SELECT id FROM admin_recovery_codes'), db())).toHaveLength(10);
    expect(await all(statement('SELECT id FROM admin_setup_codes'), db())).toEqual([]);
    expect(await challengeCount()).toBe(0);
    const audit = await listRecentAudit(5, db());
    expect(audit.map((a) => a.entity).sort()).toEqual(['authenticator', 'session']);

    // The enrolment code cannot sign in again; a recovery code from the set can.
    expect(await (await post(await passwordStep(), { code })).json()).toMatchObject({ errorCode: 'CODE_ALREADY_USED' });
    const recovery = await post(await passwordStep(), { recoveryCode: body.data.recoveryCodes[3] });
    expect(await recovery.json()).toMatchObject({ data: { recoveryCodesLeft: 9 } });
  });

  it('names the app after the device when no name is given', async () => {
    const { cookie, secret } = await enrolStep();
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect((await post(cookie, { code: await codeFor(secret) }, { 'user-agent': iphone })).status).toBe(200);
    expect(await first(statement('SELECT label FROM admin_authenticators'), db())).toEqual({ label: 'iPhone' });
  });

  it('a wrong first code keeps the challenge and is not a lockout failure', async () => {
    const { cookie, secret } = await enrolStep();
    const res = await post(cookie, { code: '000000', label: 'Phone' });
    expect(await res.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: 3 } });
    expect(await failuresToday()).toBe(0);
    expect((await post(cookie, { code: await codeFor(secret), label: 'Phone' })).status).toBe(200);
  });

  it('refuses a recovery code, and a name over 60 characters', async () => {
    const { cookie, secret } = await enrolStep();
    expect((await post(cookie, { recoveryCode: 'abcde-fgh23' })).status).toBe(400);
    expect((await post(cookie, { code: await codeFor(secret), label: 'x'.repeat(61) })).status).toBe(400);
  });

  it('a second device that enrols meanwhile wins: 409 ALREADY_ENROLLED, the setup code is spent once', async () => {
    const a = await enrolStep();
    const bCookie = await passwordStep();
    expect((await setup(jsonRequest('/api/admin/login/setup', { setupCode: SETUP }, { cookie: bCookie }))).status).toBe(200);
    expect((await post(a.cookie, { code: await codeFor(a.secret) })).status).toBe(200);
    const res = await post(bCookie, { code: '123456' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ errorCode: 'ALREADY_ENROLLED' });
    expect(await all(statement('SELECT id FROM admin_authenticators'), db())).toHaveLength(1);
  });

  it('an expired setup code at the last step: CHALLENGE_EXPIRED, nothing created', async () => {
    const { cookie, secret } = await enrolStep();
    await run(statement("UPDATE admin_setup_codes SET expires_at = '2000-01-01T00:00:00.000Z'"), db());
    const res = await post(cookie, { code: await codeFor(secret) });
    expect(await res.json()).toMatchObject({ errorCode: 'CHALLENGE_EXPIRED' });
    expect(await all(statement('SELECT id FROM admin_authenticators'), db())).toEqual([]);
    expect(await listLiveAdminSessions(new Date().toISOString(), db())).toEqual([]);
  });
});
