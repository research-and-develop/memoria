import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { listRecentAudit } from '@/lib/db/queries/audit_log';
import { adminCookie, jsonRequest, params, sessionIdOf } from '@/lib/testing/routeHarness';
import { codeFor, seedAuthenticator, TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST: add } = await import('./route');
const { POST: enroll } = await import('./enrollments/route');
const { PATCH: rename, DELETE: remove } = await import('./[id]/route');

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
    env: { APP_NAME: 'Memoria', ADMIN_EMAIL: 'a@b.c', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 },
  });
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

type Enrollment = { enrollmentId: string; secret: string; otpauthUri: string };
const confirmed = () => adminCookie(passwordHash, testDb.db, { confirmed: true });
const startEnroll = async (cookie: string) => {
  const res = await enroll(jsonRequest('/api/admin/authenticators/enrollments', {}, { cookie }));
  return { res, data: res.status === 200 ? ((await res.json()) as { data: Enrollment }).data : null };
};
const finish = (cookie: string, body: Record<string, unknown>) => add(jsonRequest('/api/admin/authenticators', body, { cookie }));
const apps = () => all<{ id: string; label: string }>(statement('SELECT id, label FROM admin_authenticators ORDER BY created_at'), db());

describe('every settings route needs a code from the last 5 minutes (D2.9)', () => {
  it.each([
    ['start adding', (c: string) => enroll(jsonRequest('/api/admin/authenticators/enrollments', {}, { cookie: c }))],
    ['add', (c: string) => finish(c, { enrollmentId: crypto.randomUUID(), label: 'x', code: '123456' })],
    ['rename', (c: string) => rename(jsonRequest('/api/admin/authenticators/x', { label: 'x' }, { method: 'PATCH', cookie: c }), params({ id: crypto.randomUUID() }))],
    ['remove', (c: string) => remove(jsonRequest('/api/admin/authenticators/x', undefined, { method: 'DELETE', cookie: c }), params({ id: crypto.randomUUID() }))],
  ])('%s: 403 SECOND_FACTOR_REQUIRED before any write', async (_label, call) => {
    await seedAuthenticator(testDb.db);
    const res = await call(await adminCookie(passwordHash, testDb.db));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ errorCode: 'SECOND_FACTOR_REQUIRED' });
    expect(await apps()).toHaveLength(1);
  });

  it('an expired window is refused', async () => {
    const cookie = await confirmed();
    await run(statement("UPDATE admin_sessions SET verified_until = '2000-01-01T00:00:00.000Z'"), db());
    expect((await startEnroll(cookie)).res.status).toBe(403);
  });

  it('without a session: 401', async () => {
    expect((await startEnroll('')).res.status).toBe(401);
  });
});

describe('adding an authenticator app', () => {
  it('scan, name, code: the app is added, its code cannot sign in again, the setup is gone', async () => {
    await seedAuthenticator(testDb.db, { label: 'Phone' });
    const cookie = await confirmed();
    const { res, data } = await startEnroll(cookie);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(data?.otpauthUri).toContain(`secret=${data?.secret}`);
    const code = await codeFor(data?.secret ?? '');
    const done = await finish(cookie, { enrollmentId: data?.enrollmentId, label: 'Tablet', code });
    expect(done.status).toBe(201);
    expect((await apps()).map((a) => a.label)).toEqual(['Phone', 'Tablet']);
    const row = await first<{ last_step: number }>(statement("SELECT last_step FROM admin_authenticators WHERE label = 'Tablet'"), db());
    expect(row?.last_step).toBeGreaterThan(0);
    expect(await all(statement("SELECT id FROM admin_mfa_challenges WHERE kind = 'add'"), db())).toEqual([]);
    expect((await listRecentAudit(5, db()))[0]).toMatchObject({ action: 'create', entity: 'authenticator' });
  });

  it('a wrong code keeps the setup; the fifth ends it', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await confirmed();
    const { data } = await startEnroll(cookie);
    for (let left = 4; left >= 1; left--) {
      const res = await finish(cookie, { enrollmentId: data?.enrollmentId, label: 'Tablet', code: '000000' });
      expect(await res.json()).toMatchObject({ errorCode: 'CODE_INVALID', details: { attemptsLeft: left } });
    }
    await finish(cookie, { enrollmentId: data?.enrollmentId, label: 'Tablet', code: '000000' });
    const res = await finish(cookie, { enrollmentId: data?.enrollmentId, label: 'Tablet', code: await codeFor(data?.secret ?? '') });
    expect(res.status).toBe(404);
  });

  it('a setup belongs to its session; it expires', async () => {
    await seedAuthenticator(testDb.db);
    const { data } = await startEnroll(await confirmed());
    const other = await confirmed();
    expect((await finish(other, { enrollmentId: data?.enrollmentId, label: 'X', code: await codeFor(data?.secret ?? '') })).status).toBe(404);
    const mine = await confirmed();
    const second = (await startEnroll(mine)).data;
    await run(statement("UPDATE admin_mfa_challenges SET expires_at = '2000-01-01T00:00:00.000Z'"), db());
    expect((await finish(mine, { enrollmentId: second?.enrollmentId, label: 'X', code: await codeFor(second?.secret ?? '') })).status).toBe(404);
  });

  it('at most 3 unfinished setups per session, and 10 apps', async () => {
    await seedAuthenticator(testDb.db);
    const cookie = await confirmed();
    for (let i = 0; i < 3; i++) expect((await startEnroll(cookie)).res.status).toBe(200);
    const fourth = await startEnroll(cookie);
    expect(fourth.res.status).toBe(409);
    expect(await fourth.res.json()).toMatchObject({ errorCode: 'AUTHENTICATOR_LIMIT' });

    const cookie2 = await confirmed();
    const { data } = await startEnroll(cookie2);
    for (let i = 0; i < 9; i++) await seedAuthenticator(testDb.db);
    const full = await finish(cookie2, { enrollmentId: data?.enrollmentId, label: 'X', code: await codeFor(data?.secret ?? '') });
    expect(full.status).toBe(409);
    expect((await startEnroll(await confirmed())).res.status).toBe(409);
    expect(await apps()).toHaveLength(10);
  });

  it('validates the name and the enrollment id', async () => {
    const cookie = await confirmed();
    expect((await finish(cookie, { enrollmentId: 'nope', label: 'X', code: '1' })).status).toBe(404);
    expect((await finish(cookie, { enrollmentId: crypto.randomUUID(), label: 'x'.repeat(61), code: '1' })).status).toBe(400);
  });
});

describe('renaming and removing', () => {
  it('renames, audited; 404 for an unknown app; the name is checked', async () => {
    const app = await seedAuthenticator(testDb.db, { label: 'Old' });
    const cookie = await confirmed();
    const call = (id: string, label: unknown) => rename(jsonRequest(`/api/admin/authenticators/${id}`, { label }, { method: 'PATCH', cookie }), params({ id }));
    expect((await call(app.id, ' New  name ')).status).toBe(200);
    expect((await apps())[0]?.label).toBe('New name');
    expect((await listRecentAudit(1, db()))[0]?.summary).toBe('Renamed authenticator app “Old” to “New name”');
    expect((await call(crypto.randomUUID(), 'X')).status).toBe(404);
    expect((await call('not-a-uuid', 'X')).status).toBe(404);
    expect((await call(app.id, '')).status).toBe(400);
  });

  it('removes one and signs out the devices it signed in (not this one); never the last', async () => {
    const phone = await seedAuthenticator(testDb.db, { label: 'Phone' });
    const tablet = await seedAuthenticator(testDb.db, { label: 'Tablet' });
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true, authenticatorId: tablet.id });
    const viaTablet = await adminCookie(passwordHash, testDb.db, { authenticatorId: tablet.id });
    const viaPhone = await adminCookie(passwordHash, testDb.db, { authenticatorId: phone.id });
    const call = (id: string) => remove(jsonRequest(`/api/admin/authenticators/${id}`, undefined, { method: 'DELETE', cookie }), params({ id }));

    expect((await call(tablet.id)).status).toBe(200);
    expect((await apps()).map((a) => a.label)).toEqual(['Phone']);
    const left = (await all<{ id: string }>(statement('SELECT id FROM admin_sessions'), db())).map((r) => r.id).sort();
    expect(left).toEqual([await sessionIdOf(cookie), await sessionIdOf(viaPhone)].sort());
    expect(left).not.toContain(await sessionIdOf(viaTablet));

    const last = await call(phone.id);
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ errorCode: 'LAST_AUTHENTICATOR' });
    expect(await apps()).toHaveLength(1);
    expect((await call(crypto.randomUUID())).status).toBe(404);
  });
});
