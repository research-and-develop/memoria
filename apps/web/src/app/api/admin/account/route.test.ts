import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminAccountRow } from '@/lib/db/queries/admin_account';
import { adminCookie, atFixedTime, jsonRequest } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { PATCH: changeEmail } = await import('./email/route');
const { PATCH: changePassword } = await import('./password/route');

const EMAIL = 'admin@example.com';
const PASSWORD = 'a-long-test-password-123';
const NEW_PASSWORD = 'a-brand-new-password-456';
let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword(PASSWORD, 1_000);
});
beforeEach(() => {
  useTestPlatform({ db: testDb.db, env: { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const emailRequest = (cookie: string, body: unknown, headers?: Record<string, string>) =>
  changeEmail(jsonRequest('/api/admin/account/email', body, { method: 'PATCH', cookie, headers }));
const passwordRequest = (cookie: string, body: unknown) => changePassword(jsonRequest('/api/admin/account/password', body, { method: 'PATCH', cookie }));
const sessionCount = async () => (await first<{ n: number }>(statement('SELECT count(*) AS n FROM admin_sessions'), db()))?.n ?? 0;
const audits = () => all<{ summary: string; details: string }>(statement("SELECT summary, details FROM audit_log WHERE entity = 'admin_account'"), db());

describe('PATCH /api/admin/account/email', () => {
  it('needs a session (401) and the same origin (403)', async () => {
    expect((await emailRequest('', { email: 'new@example.com', currentPassword: PASSWORD })).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect((await emailRequest(cookie, { email: 'new@example.com', currentPassword: PASSWORD }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('without a recent code: 403, and the password is never checked', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    for (const currentPassword of [PASSWORD, 'wrong-password']) {
      const res = await emailRequest(cookie, { email: 'new@example.com', currentPassword });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ errorCode: 'SECOND_FACTOR_REQUIRED' });
    }
    // A wrong password was not counted: it was never looked at.
    expect(await first(statement('SELECT code_failures FROM admin_sessions'), db())).toEqual({ code_failures: 0 });
    expect(await getAdminAccountRow(db())).toBeNull();
  });

  it('saves the email (the env account becomes the database one), keeps every session and set_by, audits without secrets', async () => {
    const other = await adminCookie(passwordHash, testDb.db);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await emailRequest(cookie, { email: ' New@Example.com ', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ data: { email: 'new@example.com' } });
    expect(await getAdminAccountRow(db())).toMatchObject({ email: 'new@example.com', password_hash: passwordHash, set_by: 'env' });
    expect(await sessionCount()).toBe(2);
    // Both sessions still pass the gate (same password version).
    for (const c of [cookie, other]) expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: c }))).ok).toBe(true);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/new@example\.com|pbkdf2|a-long-test/);
  });

  it('a wrong current password: 400 on the field; the fifth ends the session', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    for (let i = 1; i <= 4; i++) {
      const res = await emailRequest(cookie, { email: 'new@example.com', currentPassword: 'wrong-password' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ errorCode: 'WRONG_PASSWORD', details: { field: 'currentPassword', attemptsLeft: 5 - i } });
    }
    const last = await emailRequest(cookie, { email: 'new@example.com', currentPassword: 'wrong-password' });
    expect(last.status).toBe(401);
    expect(await last.json()).toMatchObject({ errorCode: 'SESSION_ENDED' });
    expect(last.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(await sessionCount()).toBe(0);
    expect(await getAdminAccountRow(db())).toBeNull();
  });

  it('counts the rate limit before any check: 5 an hour per session', async () => {
    await atFixedTime(async () => {
      const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
      const results = await Promise.all(Array.from({ length: 7 }, () => emailRequest(cookie, { email: 'new@example.com', currentPassword: PASSWORD })));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(5);
      expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    });
  });

  it('validates the body before anything else', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await emailRequest(cookie, { email: 'not an email', currentPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field: 'email' } });
  });

  it('409 when the account changed since it was read (a CLI reset wins)', async () => {
    await run(statement("INSERT INTO admin_account (id, email, password_hash, set_by) VALUES (1, ?, ?, 'studio')", [EMAIL, passwordHash]), db());
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const { changeAccountEmail } = await import('@/lib/auth/accountChange');
    const admin = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }));
    if (!admin.ok) throw new Error('no session');
    await run(statement("UPDATE admin_account SET password_hash = 'pbkdf2-sha256$reset-by-cli'"), db());
    expect(await changeAccountEmail(admin.ctx, 'new@example.com', new Date(), db())).toBe(false);
    expect((await getAdminAccountRow(db()))?.email).toBe(EMAIL);
    expect(await audits()).toEqual([]);
  });
});

describe('PATCH /api/admin/account/password', () => {
  it('without a recent code: 403', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await passwordRequest(cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(403);
  });

  it.each([
    ['too short', { currentPassword: PASSWORD, newPassword: 'short-pw' }, 'newPassword'],
    ['too long', { currentPassword: PASSWORD, newPassword: 'x'.repeat(129) }, 'newPassword'],
    ['the email', { currentPassword: PASSWORD, newPassword: ` ${EMAIL.toUpperCase()} ` }, 'newPassword'],
    ['no current password', { newPassword: NEW_PASSWORD }, 'currentPassword'],
  ])('refuses %s', async (_name, body, field) => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await passwordRequest(cookie, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field } });
  });

  it('saves the new password (set by the studio), ends every session and challenge, clears the cookie', async () => {
    await adminCookie(passwordHash, testDb.db);
    await run(statement("INSERT INTO admin_mfa_challenges (id, kind, password_version, expires_at) VALUES ('c', 'login', 'pv', '2099-01-01T00:00:00.000Z')"), db());
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await passwordRequest(cookie, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { signedOut: true } });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    const row = await getAdminAccountRow(db());
    expect(row).toMatchObject({ email: EMAIL, set_by: 'studio' });
    expect(await verifyPassword(NEW_PASSWORD, row?.password_hash)).toBe(true);
    expect(await verifyPassword(PASSWORD, row?.password_hash)).toBe(false);
    expect(await sessionCount()).toBe(0);
    expect(await all(statement('SELECT id FROM admin_mfa_challenges'), db())).toEqual([]);
    expect((await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }))).ok).toBe(false);
    const rows = await audits();
    expect(rows.map((r) => r.summary)).toEqual(['Changed the sign-in password']);
    expect(JSON.stringify(rows)).not.toMatch(/pbkdf2|password-4|password-1/);
  });

  it('a wrong current password changes nothing', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await passwordRequest(cookie, { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(await getAdminAccountRow(db())).toBeNull();
    expect(await sessionCount()).toBe(1);
  });
});
