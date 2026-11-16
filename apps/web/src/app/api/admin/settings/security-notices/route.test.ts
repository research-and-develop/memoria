import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { readSecurityNoticesEnabled } from '@/lib/settings/securityNotices';
import { adminCookie, jsonRequest } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { PUT } = await import('./route');

let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });
const ENV = (extra: Record<string, string> = {}) => ({
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: passwordHash,
  HASH_SALT: 'salt',
  TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
  MAIL_FROM: 'studio@example.com',
  SMTP_HOST: 'smtp.example.com',
  ...extra,
});

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(() => useTestPlatform({ db: testDb.db, env: ENV() }));
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const put = (cookie: string, body: unknown) => PUT(jsonRequest('/api/admin/settings/security-notices', body, { method: 'PUT', cookie }));
const templates = async () => (await all<{ payload: string }>(statement("SELECT payload FROM jobs WHERE kind = 'email'"), db())).map((r) => JSON.parse(r.payload).template);

describe('PUT /api/admin/settings/security-notices', () => {
  it('401 without a session; 400 without a boolean', async () => {
    expect((await put('', { enabled: false })).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect((await put(cookie, { enabled: 'no' })).status).toBe(400);
  });

  it('turning off needs a code', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await put(cookie, { enabled: false });
    expect(res.status).toBe(403);
    expect(await readSecurityNoticesEnabled(db())).toBe(true);
  });

  it('off: saved, audited, one last notice, a nudge; then nothing more', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect(await (await put(cookie, { enabled: false })).json()).toEqual({ data: { enabled: false } });
    expect(await readSecurityNoticesEnabled(db())).toBe(false);
    expect(await templates()).toEqual(['security.notices-off']);
    expect(nudgeCount()).toBe(1);
    await put(cookie, { enabled: false });
    expect(await templates()).toEqual(['security.notices-off']);
  });

  it('on: no code needed, no notice', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await put(cookie, { enabled: true })).status).toBe(200);
    expect(await readSecurityNoticesEnabled(db())).toBe(true);
    expect(await templates()).toEqual([]);
  });

  it('off without email configured: saved, no notice', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ MAIL_FROM: '', SMTP_HOST: '' }) });
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect((await put(cookie, { enabled: false })).status).toBe(200);
    expect(await templates()).toEqual([]);
    expect(nudgeCount()).toBe(0);
  });
});
