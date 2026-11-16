import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { CODE_FAILURE_RULE, recordCodeFailure } from '@/lib/auth/secondFactor';
import { windowStart } from '@/lib/security/rateLimit';
import { securityNoticesStatement } from '@/lib/settings/securityNotices';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { codeFor, seedAuthenticator, seedRecoveryCodes, seedSetupCode, TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => ({ ok: true })) }));

const { POST: login } = await import('@/app/api/admin/login/route');
const { POST: setup } = await import('@/app/api/admin/login/setup/route');
const { POST: verify } = await import('@/app/api/admin/login/verify/route');
const { POST: enroll } = await import('@/app/api/admin/authenticators/enrollments/route');
const { POST: addApp } = await import('@/app/api/admin/authenticators/route');
const { DELETE: removeApp } = await import('@/app/api/admin/authenticators/[id]/route');
const { POST: newRecoveryCodes } = await import('@/app/api/admin/recovery-codes/route');
const { POST: confirm } = await import('@/app/api/admin/second-factor/route');
const { PATCH: changeEmail } = await import('@/app/api/admin/account/email/route');
const { PATCH: changePassword } = await import('@/app/api/admin/account/password/route');

/**
 * Security notices (plan p03, D3.19), event by event through the real routes: each event writes one
 * `email` job with its template and recipient, in the event's own batch; a failed event writes none;
 * notices off or no email configured → none.
 */
const EMAIL = 'owner@example.com';
const PASSWORD = 'a-long-test-password-123';
const RECOVERY = 'abcde-fgh23';
const MAIL = { MAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com' };

let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });
const platform = (extra: Record<string, string> = MAIL) =>
  useTestPlatform({
    db: testDb.db,
    env: { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: passwordHash, TURNSTILE_SECRET_KEY: 's', HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64, ...extra },
  });

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword(PASSWORD, 1_000);
});
beforeEach(() => platform());
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

type Job = { template: string; to: unknown; params: Record<string, unknown> };
async function notices(): Promise<Job[]> {
  const rows = await all<{ payload: string }>(statement("SELECT payload FROM jobs WHERE kind = 'email' ORDER BY created_at, rowid"), db());
  return rows.map((r) => JSON.parse(r.payload) as Job);
}
const templates = async () => (await notices()).map((n) => n.template);

const challengeCookie = async () => {
  const res = await login(jsonRequest('/api/admin/login', { email: EMAIL, password: PASSWORD, turnstileToken: 't' }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie()[0]?.split(';')[0] ?? '';
};
const signIn = async (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  verify(jsonRequest('/api/admin/login/verify', body, { cookie: await challengeCookie(), headers }));

describe('sign-in', () => {
  it('a code: one notice to the account, with the device and country; nudged', async () => {
    const app = await seedAuthenticator(testDb.db);
    const res = await signIn({ code: await codeFor(app.secret) }, { 'cf-ipcountry': 'BG', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14) Version/17.0 Safari/605.1' });
    expect(res.status).toBe(200);
    const [notice, ...rest] = await notices();
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ template: 'security.sign-in', to: { account: true }, params: { method: 'code', device: 'Safari on macOS', country: 'BG' } });
    expect(nudgeCount()).toBe(1);
  });

  it('a recovery code: ONE notice (the sign-in, by recovery code), not a second one', async () => {
    await seedAuthenticator(testDb.db);
    await seedRecoveryCodes(testDb.db, [RECOVERY]);
    expect((await signIn({ recoveryCode: RECOVERY })).status).toBe(200);
    expect(await notices()).toMatchObject([{ template: 'security.sign-in', params: { method: 'recovery-code', country: null } }]);
  });

  it('first enrolment (a setup code): the sign-in notice says so', async () => {
    await seedSetupCode(testDb.db, 'ABCDEFGHIJKLMNOPQRST');
    const cookie = await challengeCookie();
    expect((await setup(jsonRequest('/api/admin/login/setup', { setupCode: 'ABCDEFGHIJKLMNOPQRST' }, { cookie }))).status).toBe(200);
    const row = await first<{ id: string; pending_secret_enc: string }>(statement('SELECT id, pending_secret_enc FROM admin_mfa_challenges'), db());
    const { testKeys } = await import('@/lib/testing/twoFactorHarness');
    const { pendingSecretAad } = await import('@/lib/auth/twoFactorKeys');
    const secret = (await (await testKeys()).decryptSecret(row?.pending_secret_enc ?? '', pendingSecretAad(row?.id ?? ''))) ?? '';
    const res = await verify(jsonRequest('/api/admin/login/verify', { code: await codeFor(secret), label: 'Phone' }, { cookie }));
    expect(res.status).toBe(200);
    expect(await notices()).toMatchObject([{ template: 'security.sign-in', params: { method: 'setup' } }]);
  });

  it('a wrong code: no notice, no nudge', async () => {
    await seedAuthenticator(testDb.db);
    expect((await signIn({ code: '000000' })).status).toBe(401);
    expect(await notices()).toEqual([]);
    expect(nudgeCount()).toBe(0);
  });

  it('notices off: no job (the sign-in still works)', async () => {
    await run(securityNoticesStatement(false), db());
    const app = await seedAuthenticator(testDb.db);
    expect((await signIn({ code: await codeFor(app.secret) })).status).toBe(200);
    expect(await notices()).toEqual([]);
  });

  it('email not configured: no job', async () => {
    platform({});
    const app = await seedAuthenticator(testDb.db);
    expect((await signIn({ code: await codeFor(app.secret) })).status).toBe(200);
    expect(await notices()).toEqual([]);
  });
});

describe('the lockout', () => {
  const window = () => windowStart(new Date(), CODE_FAILURE_RULE.windowSeconds);

  it('the failure that reaches the limit writes one notice; the ones before and after write none', async () => {
    await run(statement('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)', [CODE_FAILURE_RULE.bucket, window(), CODE_FAILURE_RULE.limit - 2]), db());
    await recordCodeFailure({ ...db() });
    expect(await notices()).toEqual([]);
    await recordCodeFailure({ ...db() });
    expect(await templates()).toEqual(['security.locked']);
    await recordCodeFailure({ ...db() });
    expect(await templates()).toEqual(['security.locked']);
    expect(nudgeCount()).toBe(1);
  });
});

describe('Settings → Security', () => {
  const confirmed = () => adminCookie(passwordHash, testDb.db, { confirmed: true });

  it('adding an app: one notice with its name; a wrong first code: none', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await confirmed();
    const started = (await (await enroll(jsonRequest('/api/admin/authenticators/enrollments', {}, { cookie }))).json()) as { data: { enrollmentId: string; secret: string } };
    const wrong = await addApp(jsonRequest('/api/admin/authenticators', { enrollmentId: started.data.enrollmentId, label: 'Tablet', code: '000000' }, { cookie }));
    expect(wrong.status).toBe(400);
    expect(await notices()).toEqual([]);
    const res = await addApp(jsonRequest('/api/admin/authenticators', { enrollmentId: started.data.enrollmentId, label: 'Tablet <script>', code: await codeFor(started.data.secret) }, { cookie }));
    expect(res.status).toBe(201);
    expect(await notices()).toMatchObject([{ template: 'security.authenticator-added', to: { account: true }, params: { label: 'Tablet <script>' } }]);
    expect(nudgeCount()).toBe(1);
  });

  it('removing an app: one notice and its audit; removing it again: neither', async () => {
    await seedAuthenticator(testDb.db, { label: 'Phone' });
    const tablet = await seedAuthenticator(testDb.db, { label: 'Tablet' });
    const cookie = await confirmed();
    const del = () => removeApp(jsonRequest(`/api/admin/authenticators/${tablet.id}`, undefined, { method: 'DELETE', cookie }), params({ id: tablet.id }));
    expect((await del()).status).toBe(200);
    expect(await notices()).toMatchObject([{ template: 'security.authenticator-removed', params: { label: 'Tablet' } }]);
    const audits = async () => (await all(statement("SELECT id FROM audit_log WHERE entity = 'authenticator' AND action = 'delete'"), db())).length;
    expect(await audits()).toBe(1);
    expect((await del()).status).toBe(404);
    expect(await notices()).toHaveLength(1);
    expect(await audits()).toBe(1);
  });

  it('removing an app with notices off: the audit still chains on the delete', async () => {
    await run(securityNoticesStatement(false), db());
    await seedAuthenticator(testDb.db, { label: 'Phone' });
    const tablet = await seedAuthenticator(testDb.db, { label: 'Tablet' });
    const cookie = await confirmed();
    expect((await removeApp(jsonRequest(`/api/admin/authenticators/${tablet.id}`, undefined, { method: 'DELETE', cookie }), params({ id: tablet.id }))).status).toBe(200);
    expect(await notices()).toEqual([]);
    expect(await all(statement("SELECT id FROM audit_log WHERE entity = 'authenticator' AND action = 'delete'"), db())).toHaveLength(1);
  });

  it('new recovery codes: one notice', async () => {
    await seedAuthenticator(testDb.db);
    const res = await newRecoveryCodes(jsonRequest('/api/admin/recovery-codes', {}, { cookie: await confirmed() }));
    expect(res.status).toBe(200);
    expect(await templates()).toEqual(['security.recovery-codes-regenerated']);
  });

  it('a recovery code used to confirm: one notice; a wrong one: none', async () => {
    await seedAuthenticator(testDb.db);
    await seedRecoveryCodes(testDb.db, [RECOVERY]);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await confirm(jsonRequest('/api/admin/second-factor', { recoveryCode: 'zzzzz-zzzzz' }, { cookie }))).status).toBe(401);
    expect(await notices()).toEqual([]);
    const res = await confirm(jsonRequest('/api/admin/second-factor', { recoveryCode: RECOVERY }, { cookie }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { recoveryCodesLeft: number } }).data.recoveryCodesLeft).toBe(0);
    expect(await templates()).toEqual(['security.recovery-code-used']);
  });

  it('a code from an app to confirm: no notice', async () => {
    const app = await seedAuthenticator(testDb.db);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await confirm(jsonRequest('/api/admin/second-factor', { code: await codeFor(app.secret) }, { cookie }))).status).toBe(200);
    expect(await notices()).toEqual([]);
  });
});

describe('Your sign-in', () => {
  const confirmed = () => adminCookie(passwordHash, testDb.db, { confirmed: true });

  it('a new email: the old and the new address are told, by explicit address; the audit still holds', async () => {
    const res = await changeEmail(jsonRequest('/api/admin/account/email', { email: 'new@example.com', currentPassword: PASSWORD }, { method: 'PATCH', cookie: await confirmed() }));
    expect(res.status).toBe(200);
    expect(await notices()).toMatchObject([
      { template: 'security.email-changed', to: { email: EMAIL }, params: { role: 'old' } },
      { template: 'security.email-changed', to: { email: 'new@example.com' }, params: { role: 'new' } },
    ]);
    expect(await all(statement("SELECT id FROM audit_log WHERE entity = 'admin_account'"), db())).toHaveLength(1);
    expect(nudgeCount()).toBe(1);
  });

  it('a wrong current password: no notice', async () => {
    const res = await changeEmail(jsonRequest('/api/admin/account/email', { email: 'new@example.com', currentPassword: 'not-the-password-1' }, { method: 'PATCH', cookie: await confirmed() }));
    expect(res.status).toBe(400);
    expect(await notices()).toEqual([]);
  });

  it('a new password: one notice to the account', async () => {
    const res = await changePassword(
      jsonRequest('/api/admin/account/password', { currentPassword: PASSWORD, newPassword: 'another-long-password-456' }, { method: 'PATCH', cookie: await confirmed() }),
    );
    expect(res.status).toBe(200);
    expect(await notices()).toMatchObject([{ template: 'security.password-changed', to: { account: true } }]);
  });
});
