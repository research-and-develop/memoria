import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getSiteSetting, upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';
import { MAIL_SETTING_KEY, readMailSetup } from '@/lib/settings/mail';
import { adminCookie, jsonRequest } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { PUT } = await import('./route');

const SETTINGS_KEY = btoa(String.fromCharCode(...Uint8Array.from({ length: 32 }, (_, i) => 200 - i)));
let testDb: TestDb;
let passwordHash: string;
const db = () => ({ db: testDb.db });
const ENV = (extra: Record<string, string> = {}) => ({
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD_HASH: passwordHash,
  HASH_SALT: 'salt',
  TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
  SETTINGS_ENCRYPTION_KEY: SETTINGS_KEY,
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

const SMTP = { provider: 'smtp', from: { email: 'hello@lumen.example', name: 'Lumen' }, replyTo: '', smtp: { host: 'smtp.example.com', port: 587, username: 'studio-login', password: 'app-password' } };
const save = (cookie: string, body: unknown, headers?: Record<string, string>) => PUT(jsonRequest('/api/admin/settings/mail', body, { method: 'PUT', cookie, headers }));
const stored = async () => (await getSiteSetting(MAIL_SETTING_KEY, db()))?.value as Record<string, Record<string, unknown>> | undefined;
const jobs = () => all<{ payload: string }>(statement("SELECT payload FROM jobs WHERE kind = 'email'"), db());
const audits = () => all<{ details: string; summary: string }>(statement("SELECT details, summary FROM audit_log WHERE entity_id = 'mail'"), db());

describe('PUT /api/admin/settings/mail', () => {
  it('401 without a session, 403 cross-origin; nothing saved', async () => {
    expect((await save('', SMTP)).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    expect((await save(cookie, SMTP, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await stored()).toBeUndefined();
  });

  it('needs a code: 403 SECOND_FACTOR_REQUIRED, nothing saved', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await save(cookie, SMTP);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ errorCode: 'SECOND_FACTOR_REQUIRED' });
    expect(await stored()).toBeUndefined();
  });

  it('without SETTINGS_ENCRYPTION_KEY → 503 SETTINGS_KEY_MISSING', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ SETTINGS_ENCRYPTION_KEY: '' }) });
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await save(cookie, SMTP);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ errorCode: 'SETTINGS_KEY_MISSING' });
  });

  it('saves sealed: the stored password is v1:…, the response has no secret, the audit neither', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await save(cookie, SMTP);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      data: { provider: 'smtp', from: { email: 'hello@lumen.example', name: 'Lumen' }, replyTo: null, smtp: { host: 'smtp.example.com', port: 587, username: 'studio-login' }, secretSaved: true },
    });
    const row = await stored();
    expect(row?.smtp?.password).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain('app-password');
    expect(JSON.stringify(await audits())).not.toMatch(/app-password|hello@lumen|studio-login/);
    expect((await readMailSetup())?.transport).toMatchObject({ provider: 'smtp', smtp: { password: 'app-password', security: 'starttls' } });
  });

  it('an empty secret keeps the saved one when nothing else of the provider changed', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, SMTP);
    const before = (await stored())?.smtp?.password;
    const res = await save(cookie, { ...SMTP, from: { email: 'hi@lumen.example', name: '' }, smtp: { ...SMTP.smtp, password: '' } });
    expect(res.status).toBe(200);
    expect((await stored())?.smtp?.password).toBe(before);
    expect((await stored())?.from).toEqual({ email: 'hi@lumen.example', name: null });
  });

  it.each([
    ['the host', { host: 'smtp.other.example' }],
    ['the username', { username: 'someone-else' }],
    ['the port', { port: 465 }],
  ])('changing %s with an empty secret → 400 SECRET_REQUIRED', async (_label, change) => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, SMTP);
    const res = await save(cookie, { ...SMTP, smtp: { ...SMTP.smtp, ...change, password: '' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'SECRET_REQUIRED', details: { field: 'smtp.password' } });
  });

  it('switching provider without its secret → 400 SECRET_REQUIRED', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, SMTP);
    const res = await save(cookie, { provider: 'brevo', from: SMTP.from, brevo: { apiKey: '' } });
    expect(await res.json()).toMatchObject({ errorCode: 'SECRET_REQUIRED', details: { field: 'brevo.apiKey' } });
  });

  it.each([
    ['port 25', { ...SMTP, smtp: { ...SMTP.smtp, port: 25 } }, 'smtp.port'],
    ['an IP host', { ...SMTP, smtp: { ...SMTP.smtp, host: '203.0.113.9' } }, 'smtp.host'],
    ['localhost', { ...SMTP, smtp: { ...SMTP.smtp, host: 'localhost' } }, 'smtp.host'],
    ['a bad tenant', { provider: 'microsoft365', from: SMTP.from, microsoft365: { tenantId: 'a/b', clientId: '11111111-2222-4333-8444-555555555555', clientSecret: 's', mailbox: '' } }, 'microsoft365.tenantId'],
    ['an unknown region', { provider: 'ses', from: SMTP.from, ses: { region: 'mars-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 's' } }, 'ses.region'],
    ['a bad From', { ...SMTP, from: { email: 'nope' } }, 'from.email'],
  ])('refuses %s (400 INVALID_PARAMS, field %s)', async (_label, body, field) => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    const res = await save(cookie, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field } });
  });

  it('the notice that the settings changed goes through the PREVIOUS settings (sealed), and nudges', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, SMTP);
    const first = await jobs();
    expect(first).toHaveLength(1);
    expect(JSON.parse(first[0]!.payload)).toMatchObject({ template: 'security.mail-settings-changed', to: { account: true }, params: { provider: 'SMTP server', fromDomain: 'lumen.example' } });
    expect(JSON.parse(first[0]!.payload)).not.toHaveProperty('via');

    const previous = await stored();
    await save(cookie, { provider: 'brevo', from: SMTP.from, brevo: { apiKey: 'xkeysib-new' } });
    const all2 = await jobs();
    expect(all2).toHaveLength(2);
    const second = JSON.parse(all2[1]!.payload);
    expect(second).toMatchObject({ template: 'security.mail-settings-changed', params: { provider: 'Brevo' } });
    expect(second.via).toEqual(previous);
    expect(JSON.stringify(second)).not.toMatch(/app-password|xkeysib-new/);
    expect(nudgeCount()).toBe(2);
  });

  it('no notice when security notices are off', async () => {
    await run(upsertSiteSettingStatement('security_notices', { enabled: false }), db());
    const cookie = await adminCookie(passwordHash, testDb.db, { confirmed: true });
    await save(cookie, SMTP);
    expect(await jobs()).toEqual([]);
    expect(nudgeCount()).toBe(0);
  });
});
