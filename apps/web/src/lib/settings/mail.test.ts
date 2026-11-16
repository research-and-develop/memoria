import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { run } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';

import { MAIL_SETTING_KEY, readMailSetup } from './mail';
import { parseMailSettings } from './parseMailSettings';
import { mailSecretAad, settingsCipher } from './secrets';

const SEALED = 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FROM = { email: 'hello@lumen.example', name: 'Lumen' };
const TENANT = '0f3c1e2d-4b5a-6789-abcd-ef0123456789';
const row = (provider: string, block: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ provider, from: FROM, replyTo: null, [provider]: block, ...over });
const SMTP = { host: 'smtp.example.com', port: 587, username: 'studio-login', password: SEALED };
const SES = { region: 'eu-west-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: SEALED };
const M365 = { tenantId: TENANT, clientId: '11111111-2222-4333-8444-555555555555', clientSecret: SEALED, mailbox: 'studio@lumen.example' };

describe('parseMailSettings', () => {
  it.each([
    ['smtp', row('smtp', SMTP)],
    ['smtp on 465', row('smtp', { ...SMTP, port: 465 })],
    ['brevo', row('brevo', { apiKey: SEALED })],
    ['ses', row('ses', SES)],
    ['microsoft365', row('microsoft365', M365)],
    ['microsoft365 with a domain tenant', row('microsoft365', { ...M365, tenantId: 'lumen.onmicrosoft.com' })],
    ['a reply-to and no From name', row('brevo', { apiKey: SEALED }, { replyTo: 'me@lumen.example', from: { email: 'hello@lumen.example', name: null } })],
  ])('accepts %s', (_label, value) => {
    const parsed = parseMailSettings(value);
    expect(parsed.ok).toBe(true);
  });

  it('keeps only the chosen provider’s block', () => {
    const parsed = parseMailSettings({ ...row('brevo', { apiKey: SEALED }), smtp: SMTP });
    expect(parsed).toEqual({ ok: true, value: { provider: 'brevo', from: FROM, replyTo: null, brevo: { apiKey: SEALED } } });
  });

  it.each([
    ['not an object', 'mail', 'mail'],
    ['an unknown provider', row('gmail', {}), 'provider'],
    ['no From address', row('brevo', { apiKey: SEALED }, { from: { email: 'nope' } }), 'from'],
    ['a From name with LF', row('brevo', { apiKey: SEALED }, { from: { email: 'a@b.example', name: 'A\nB' } }), 'fromName'],
    ['a long From name', row('brevo', { apiKey: SEALED }, { from: { email: 'a@b.example', name: 'x'.repeat(101) } }), 'fromName'],
    ['a bad reply-to', row('brevo', { apiKey: SEALED }, { replyTo: 'x' }), 'replyTo'],
    ['no provider block', { provider: 'smtp', from: FROM, replyTo: null }, 'smtp'],
    ['an IP host', row('smtp', { ...SMTP, host: '203.0.113.5' }), 'smtp.host'],
    ['localhost', row('smtp', { ...SMTP, host: 'localhost' }), 'smtp.host'],
    ['a .local host', row('smtp', { ...SMTP, host: 'mail.office.local' }), 'smtp.host'],
    ['port 25', row('smtp', { ...SMTP, port: 25 }), 'smtp.port'],
    ['a port as text', row('smtp', { ...SMTP, port: '587' }), 'smtp.port'],
    ['no username', row('smtp', { ...SMTP, username: '' }), 'smtp.username'],
    ['a plain password', row('smtp', { ...SMTP, password: 'hunter2' }), 'smtp.password'],
    ['a plain Brevo key', row('brevo', { apiKey: 'xkeysib-1' }), 'brevo.apiKey'],
    ['an unknown region', row('ses', { ...SES, region: 'mars-north-1' }), 'ses.region'],
    ['a bad key id', row('ses', { ...SES, accessKeyId: 'akia lower' }), 'ses.accessKeyId'],
    ['a tenant with a slash', row('microsoft365', { ...M365, tenantId: 'a/b' }), 'microsoft365.tenantId'],
    ['a client id that is not a GUID', row('microsoft365', { ...M365, clientId: 'app' }), 'microsoft365.clientId'],
    ['a bad mailbox', row('microsoft365', { ...M365, mailbox: 'studio' }), 'microsoft365.mailbox'],
  ])('refuses %s (field %s)', (_label, value, field) => {
    expect(parseMailSettings(value)).toEqual({ ok: false, field });
  });
});

describe('readMailSetup', () => {
  const KEY = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const ENV = { MAIL_FROM: 'dev@example.com', SMTP_HOST: 'smtp.example.com', SETTINGS_ENCRYPTION_KEY: btoa(String.fromCharCode(...KEY)) };
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterEach(async () => {
    resetTestPlatform();
    await testDb.reset();
  });
  afterAll(() => testDb.dispose());

  it('no row and no env → null (not configured)', async () => {
    useTestPlatform({ db: testDb.db, env: {} });
    expect(await readMailSetup()).toBeNull();
  });

  it('no row → the env fallback, source env', async () => {
    useTestPlatform({ db: testDb.db, env: ENV });
    expect(await readMailSetup()).toEqual({
      source: 'env',
      from: { email: 'dev@example.com' },
      replyTo: null,
      transport: { provider: 'smtp', smtp: { host: 'smtp.example.com', port: 587, security: 'starttls', username: null, password: null } },
    });
  });

  it('a row wins over env: SMTP security from the port, the password decrypted', async () => {
    useTestPlatform({ db: testDb.db, env: ENV });
    const password = await (await settingsCipher(KEY)).encrypt('app-password', mailSecretAad('smtp', 'password'));
    await run(upsertSiteSettingStatement(MAIL_SETTING_KEY, row('smtp', { ...SMTP, port: 465, password }, { replyTo: 'me@lumen.example' })));
    expect(await readMailSetup()).toEqual({
      source: 'database',
      from: FROM,
      replyTo: { email: 'me@lumen.example' },
      transport: { provider: 'smtp', smtp: { host: 'smtp.example.com', port: 465, security: 'tls', username: 'studio-login', password: 'app-password' } },
    });
  });

  it('a secret moved to another field does not decrypt (AAD)', async () => {
    useTestPlatform({ db: testDb.db, env: ENV });
    const sealedForSmtp = await (await settingsCipher(KEY)).encrypt('app-password', mailSecretAad('smtp', 'password'));
    await run(upsertSiteSettingStatement(MAIL_SETTING_KEY, row('ses', { ...SES, secretAccessKey: sealedForSmtp })));
    await expect(readMailSetup()).rejects.toMatchObject({ code: 'MAIL_SECRET_UNREADABLE', configuration: true });
  });

  it('without SETTINGS_ENCRYPTION_KEY a saved row cannot be used → SETTINGS_KEY_MISSING', async () => {
    useTestPlatform({ db: testDb.db, env: { ...ENV, SETTINGS_ENCRYPTION_KEY: '' } });
    await run(upsertSiteSettingStatement(MAIL_SETTING_KEY, row('brevo', { apiKey: SEALED })));
    await expect(readMailSetup()).rejects.toMatchObject({ code: 'SETTINGS_KEY_MISSING', configuration: true });
  });

  it('an invalid row is ignored (logged): the env fallback applies', async () => {
    useTestPlatform({ db: testDb.db, env: ENV });
    await run(upsertSiteSettingStatement(MAIL_SETTING_KEY, row('smtp', { ...SMTP, host: '10.0.0.1' })));
    expect((await readMailSetup())?.source).toBe('env');
  });
});
