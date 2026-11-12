import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, useTestDb, type TestDb } from '@repo/db/test-utils';

import { hashPassword } from '@/lib/auth/password';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { sessionCookieName } from '@/lib/auth/session';
import { listRecentAudit } from '@/lib/db/queries/audit_log';
import { listLiveAdminSessions } from '@/lib/db/queries/admin_sessions';
import { atFixedTime, jsonRequest } from '@/lib/testing/routeHarness';

const cf = vi.hoisted(() => ({ env: {} as Record<string, string>, waitUntil: [] as Promise<unknown>[] }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cf.env, ctx: { waitUntil: (p: Promise<unknown>) => cf.waitUntil.push(p) } }),
}));
const turnstile = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; reason?: string } }));
vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => turnstile.result) }));

const { POST: login } = await import('./route');
const { POST: logout } = await import('../logout/route');

const EMAIL = 'admin@example.com';
const PASSWORD = 'a-long-test-password-123';
let testDb: TestDb;
let passwordHash: string;

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword(PASSWORD, 1_000);
});
beforeEach(() => {
  useTestDb(testDb.db);
  cf.env = { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD_HASH: passwordHash, TURNSTILE_SECRET_KEY: 'secret', HASH_SALT: 'salt' };
  cf.waitUntil = [];
  turnstile.result = { ok: true };
});
afterEach(async () => {
  await Promise.allSettled(cf.waitUntil);
  useTestDb(null);
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const credentials = (overrides: Record<string, unknown> = {}) => ({ email: EMAIL, password: PASSWORD, turnstileToken: 't', ...overrides });
const cookieFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

describe('POST /api/admin/login', () => {
  it('signs in: sets an httpOnly session cookie, stores only its hash, audits the login', async () => {
    const res = await login(jsonRequest('/api/admin/login', credentials({ email: ' Admin@Example.COM ' })));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`^${sessionCookieName(false)}=[A-Za-z0-9_-]{43};`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const token = cookieFrom(res).split('=')[1];
    const sessions = await listLiveAdminSessions(new Date().toISOString(), { db: testDb.db });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).not.toBe(token);
    expect((await listRecentAudit(5, { db: testDb.db }))[0]).toMatchObject({ action: 'login', entity: 'session' });

    const gate = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie: cookieFrom(res) }));
    expect(gate.ok).toBe(true);
  });

  it.each([
    ['a wrong password', credentials({ password: 'wrong' })],
    ['an unknown email', credentials({ email: 'someone@else.com' })],
  ])('refuses %s with one generic message and no session', async (_label, body) => {
    const res = await login(jsonRequest('/api/admin/login', body));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_CREDENTIALS', details: { message: 'Wrong email or password.' } });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await listLiveAdminSessions(new Date().toISOString(), { db: testDb.db })).toEqual([]);
  });

  it('refuses a failed Turnstile check before looking at the password', async () => {
    turnstile.result = { ok: false, reason: 'rejected' };
    const res = await login(jsonRequest('/api/admin/login', credentials()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'TURNSTILE_FAILED' });
  });

  it('rate-limits after 10 attempts from one IP', async () => {
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
    cf.env.ADMIN_PASSWORD_HASH = '';
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

describe('sessions', () => {
  async function signIn() {
    return cookieFrom(await login(jsonRequest('/api/admin/login', credentials())));
  }

  it('a rotated password ends every session', async () => {
    const cookie = await signIn();
    cf.env.ADMIN_PASSWORD_HASH = await hashPassword('a-new-long-password-456', 1_000);
    const gate = await requireAdmin(jsonRequest('/api/admin/x', undefined, { cookie }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    expect(await listLiveAdminSessions(new Date().toISOString(), { db: testDb.db })).toEqual([]);
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
    expect(await listLiveAdminSessions(new Date().toISOString(), { db: testDb.db })).toEqual([]);
  });
});
