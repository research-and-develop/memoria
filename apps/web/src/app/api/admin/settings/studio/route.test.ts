import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getSiteSetting } from '@/lib/db/queries/site_settings';
import { readStudio } from '@/lib/settings/studio';
import { adminCookie, jsonRequest } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { PATCH } = await import('./route');

let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });
const ENV = (extra: Record<string, string> = {}) => ({
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: passwordHash,
  HASH_SALT: 'salt',
  TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
  APP_NAME: 'Env Studio',
  ...extra,
});

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(() => {
  useTestPlatform({ db: testDb.db, env: ENV() });
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const save = (cookie: string, body: unknown, headers?: Record<string, string>) =>
  PATCH(jsonRequest('/api/admin/settings/studio', body, { method: 'PATCH', cookie, headers }));
const audits = () => all<{ entity_id: string; details: string }>(statement("SELECT entity_id, details FROM audit_log WHERE entity = 'site_settings'"), db());

describe('PATCH /api/admin/settings/studio', () => {
  it('needs a session (401) and the same origin (403)', async () => {
    expect((await save('', { name: 'X' })).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect((await save(cookie, { name: 'X' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await getSiteSetting('studio', db())).toBeNull();
  });

  it('a new name needs no code; saved, audited with the field names only, no-store', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await save(cookie, { name: '  North Light  ', siteUrl: '' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ data: { name: 'North Light', siteUrl: null } });
    expect((await getSiteSetting('studio', db()))?.value).toEqual({ name: 'North Light', siteUrl: null });
    expect(await readStudio()).toEqual({ name: 'North Light', siteUrl: null });
    const rows = await audits();
    expect(rows).toEqual([{ entity_id: 'studio', details: JSON.stringify({ fields: ['name'] }) }]);
    expect(JSON.stringify(rows)).not.toMatch(/North Light/);
  });

  it('a new website address needs a code: 403 without one, nothing saved', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await save(cookie, { name: 'Env Studio', siteUrl: 'photos.example.com' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ errorCode: 'SECOND_FACTOR_REQUIRED' });
    expect(await getSiteSetting('studio', db())).toBeNull();
    expect(await audits()).toEqual([]);
  });

  it('with a code: a bare domain is saved as an https origin', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await save(cookie, { name: 'Env Studio', siteUrl: 'Photos.Example.com' });
    expect(await res.json()).toEqual({ data: { name: 'Env Studio', siteUrl: 'https://photos.example.com' } });
    expect(await readStudio()).toEqual({ name: 'Env Studio', siteUrl: 'https://photos.example.com' });
    expect((await audits()).map((r) => r.details)).toEqual([JSON.stringify({ fields: ['siteUrl'] })]);
  });

  it('clearing the address falls back to SITE_URL; that is no change when it is already in use', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ SITE_URL: 'https://env.example.com' }) });
    const plain = await adminCookie(passwordHash, testDb.db);
    // Empty = SITE_URL, which is what is in use: no code, nothing written.
    const same = await save(plain, { name: 'Env Studio', siteUrl: '' });
    expect(await same.json()).toEqual({ data: { name: 'Env Studio', siteUrl: 'https://env.example.com' } });
    expect(await getSiteSetting('studio', db())).toBeNull();

    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, { name: 'Env Studio', siteUrl: 'photos.example.com' });
    // Back to the default is a change of address: a code again.
    expect((await save(plain, { name: 'Env Studio', siteUrl: '' })).status).toBe(403);
    const cleared = await save(cookie, { name: 'Env Studio', siteUrl: '' });
    expect(await cleared.json()).toEqual({ data: { name: 'Env Studio', siteUrl: 'https://env.example.com' } });
    expect((await getSiteSetting('studio', db()))?.value).toEqual({ name: 'Env Studio', siteUrl: null });
  });

  it.each([
    [{ name: '', siteUrl: '' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ name: 'A​B' }, 'name'],
    [{ name: 'Studio', siteUrl: 'http://photos.example.com' }, 'siteUrl'],
    [{ name: 'Studio', siteUrl: 'photos.example.com/gallery' }, 'siteUrl'],
    [{ name: 'Studio', siteUrl: 'localhost:3210' }, 'siteUrl'],
  ])('refuses %j on its field (400)', async (body, field) => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await save(cookie, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field } });
    expect(await getSiteSetting('studio', db())).toBeNull();
  });
});
