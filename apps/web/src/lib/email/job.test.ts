import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { batch, run } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { logger } from '@repo/logger';
import { MailError } from '@repo/platform/mail/error';
import type { MailTransport } from '@repo/platform/mail/transport';
import { memoryMailer, type MemoryMailer } from '@repo/platform/memory/mailer';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { getJob } from '@/lib/db/queries/jobs';
import { upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';
import { runDueJobs } from '@/lib/jobs/runner';
import { MAIL_SETTING_KEY } from '@/lib/settings/mail';
import { mailSecretAad, settingsCipher } from '@/lib/settings/secrets';
import { STUDIO_SETTING_KEY } from '@/lib/settings/studio';

import { emailJob, emailJobStatement } from './job';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
const KEY_B64 = btoa(String.fromCharCode(...KEY));
const ENV = {
  NEXTJS_ENV: 'development',
  APP_NAME: 'Studio Lumen',
  MAIL_FROM: 'studio@example.com',
  SMTP_HOST: '127.0.0.1',
  SMTP_SECURITY: 'none',
  SETTINGS_ENCRYPTION_KEY: KEY_B64,
  ADMIN_EMAIL: 'owner@example.net',
  ADMIN_PASSWORD_HASH: 'pbkdf2-sha256$1$x$y',
};
const NOW = new Date('2026-11-16T10:00:00.000Z');

let testDb: TestDb;
let mailer: MemoryMailer;
let transports: MailTransport[];
beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => {
  useTestPlatform({ db: testDb.db, env: ENV });
  mailer = memoryMailer();
  transports = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const drain = () =>
  runDueJobs({
    trigger: 'nudge',
    clock: () => NOW,
    mailerFor: (transport) => {
      transports.push(transport);
      return mailer;
    },
  });

async function queueTest(over: { to?: Parameters<typeof emailJobStatement>[0]['to']; maxAttempts?: number } = {}) {
  const job = emailJobStatement({ template: 'test', to: over.to ?? { email: 'client@example.org' }, params: { queuedAt: NOW.toISOString() }, now: NOW, maxAttempts: over.maxAttempts });
  await run(job.statement);
  return job.id;
}

describe('the email job', () => {
  it('renders and sends through the env fallback; done keeps the provider id, drops params', async () => {
    const id = await queueTest();
    expect(await drain()).toMatchObject({ done: 1 });
    expect(mailer.sent).toHaveLength(1);
    const sent = mailer.sent[0]!;
    expect(sent).toMatchObject({ id, from: { email: 'studio@example.com', name: 'Studio Lumen' }, to: { email: 'client@example.org' }, subject: 'Test email from Studio Lumen' });
    expect(sent.replyTo).toBeUndefined();
    expect(sent.text).toContain('16 Nov 2026, 10:00');
    expect(transports).toEqual([{ provider: 'smtp', smtp: { host: '127.0.0.1', port: 1025, security: 'none', username: null, password: null } }]);
    const job = await getJob(id);
    expect(job).toMatchObject({ status: 'done', payload: { v: 1, template: 'test', to: { email: 'client@example.org' }, providerMessageId: 'memory-1' } });
    expect(job?.payload).not.toHaveProperty('params');
  });

  it('uses the studio name saved in Settings → Studio', async () => {
    await run(upsertSiteSettingStatement(STUDIO_SETTING_KEY, { name: 'Ателие Светлина', siteUrl: null }));
    await queueTest();
    await drain();
    expect(mailer.sent[0]).toMatchObject({ from: { name: 'Ателие Светлина' }, subject: 'Test email from Ателие Светлина' });
  });

  it('{ account: true } goes to the sign-in account, looked up when sending', async () => {
    await queueTest({ to: { account: true } });
    await drain();
    expect(mailer.sent[0]?.to).toEqual({ email: 'owner@example.net' });
  });

  it('no mail settings and no env fallback → MAIL_NOT_CONFIGURED, retried, logged as an error', async () => {
    useTestPlatform({ db: testDb.db, env: { ...ENV, MAIL_FROM: '', SMTP_HOST: '' } });
    const error = vi.spyOn(logger, 'error');
    const id = await queueTest();
    expect(await drain()).toMatchObject({ retried: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'MAIL_NOT_CONFIGURED' });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'job_retry', code: 'MAIL_NOT_CONFIGURED' }));
    expect(mailer.sent).toEqual([]);
  });

  it('the env problem is the reason when the fallback is half set', async () => {
    useTestPlatform({ db: testDb.db, env: { ...ENV, SMTP_PORT: 'x' } });
    const id = await queueTest();
    await drain();
    expect((await getJob(id))?.last_error).toBe('MAIL_NOT_CONFIGURED: SMTP_PORT must be a port number');
  });

  it('the test email gets one attempt: a transient failure fails it at once', async () => {
    mailer.failWith(new MailError('SMTP_451'));
    const id = await queueTest({ maxAttempts: 1 });
    expect(await drain()).toMatchObject({ failed: 1 });
    expect(await getJob(id)).toMatchObject({ status: 'failed', attempts: 1, last_error: 'SMTP_451' });
  });

  it('saved settings win over env: the secret is decrypted for the transport; From name, reply-to', async () => {
    const cipher = await settingsCipher(KEY);
    const apiKey = await cipher.encrypt('xkeysib-secret', mailSecretAad('brevo', 'apiKey'));
    await run(
      upsertSiteSettingStatement(MAIL_SETTING_KEY, { provider: 'brevo', from: { email: 'hello@lumen.example', name: 'Lumen' }, replyTo: 'me@lumen.example', brevo: { apiKey } }),
    );
    await queueTest();
    await drain();
    expect(transports).toEqual([{ provider: 'brevo', brevo: { apiKey: 'xkeysib-secret' } }]);
    expect(mailer.sent[0]).toMatchObject({ from: { email: 'hello@lumen.example', name: 'Lumen' }, replyTo: { email: 'me@lumen.example' } });
  });

  it('a secret sealed under another key → MAIL_SECRET_UNREADABLE (retried), settings_key_mismatch logged', async () => {
    const other = await settingsCipher(Uint8Array.from({ length: 32 }, () => 1));
    const apiKey = await other.encrypt('xkeysib-secret', mailSecretAad('brevo', 'apiKey'));
    await run(upsertSiteSettingStatement(MAIL_SETTING_KEY, { provider: 'brevo', from: { email: 'hello@lumen.example', name: null }, replyTo: null, brevo: { apiKey } }));
    const error = vi.spyOn(logger, 'error');
    const id = await queueTest();
    await drain();
    expect(await getJob(id)).toMatchObject({ status: 'pending', last_error: 'MAIL_SECRET_UNREADABLE: brevo.apiKey' });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings_key_mismatch', provider: 'brevo' }));
    expect(transports).toEqual([]);
  });

  it('a template this code does not know waits (UNKNOWN_KIND) without spending the attempt', async () => {
    const job = emailJobStatement({ template: 'test', to: { email: 'client@example.org' }, params: { queuedAt: NOW.toISOString() }, now: NOW });
    await run(job.statement);
    await testDb.db.batch([{ sql: `UPDATE jobs SET payload = json_set(payload, '$.template', 'gallery-ready') WHERE id = ?`, params: [job.id] }]);
    expect(await drain()).toMatchObject({ deferred: 1 });
    expect(await getJob(job.id)).toMatchObject({ status: 'pending', attempts: 0, last_error: 'UNKNOWN_KIND' });
  });

  it('logs never carry the address, the name or the parameters', async () => {
    const lines: unknown[] = [];
    for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(logger, level).mockImplementation((entry) => void lines.push(entry));
    mailer.failWith(new MailError('SMTP_550', { permanent: true, detail: 'rejected ***' }));
    await queueTest({ to: { email: 'client@example.org', name: 'Maria Client' } });
    await drain();
    const text = JSON.stringify(lines);
    expect(text).not.toContain('client@example.org');
    expect(text).not.toContain('Maria');
    expect(text).not.toContain('queuedAt');
  });
});

describe('emailJob.parse', () => {
  const payload = (over: Record<string, unknown> = {}) => ({ v: 1, template: 'test', to: { email: 'client@example.org' }, params: { queuedAt: NOW.toISOString() }, ...over });
  it.each([
    ['a good payload', payload(), true, false],
    ['the account', payload({ to: { account: true } }), true, false],
    ['a name', payload({ to: { email: 'client@example.org', name: 'Maria' } }), true, false],
    ['an unknown template (newer code)', payload({ template: 'gallery-ready' }), false, true],
    ['a bad address', payload({ to: { email: 'nope' } }), false, false],
    ['a name with CR/LF', payload({ to: { email: 'client@example.org', name: 'a\r\nBcc: x@y.z' } }), false, false],
    ['bad params', payload({ params: { queuedAt: 'yesterday' } }), false, false],
    ['no template', payload({ template: 7 }), false, false],
  ])('%s', (_label, value, ok, unknown) => {
    const parsed = emailJob.parse(value);
    expect(parsed.ok).toBe(ok);
    if (!parsed.ok) expect(parsed.unknown).toBe(unknown);
  });

  it('emailJobStatement refuses bad parameters (a programming error)', () => {
    expect(() => emailJobStatement({ template: 'test', to: { email: 'client@example.org' }, params: {}, now: NOW })).toThrow(/does not parse/);
  });

  it('two emails in one batch, each its own job', async () => {
    const a = emailJobStatement({ template: 'test', to: { email: 'a@example.org' }, params: { queuedAt: NOW.toISOString() }, now: NOW });
    const b = emailJobStatement({ template: 'test', to: { account: true }, params: { queuedAt: NOW.toISOString() }, now: NOW });
    await batch([a.statement, b.statement]);
    expect(await getJob(a.id)).toMatchObject({ kind: 'email', max_attempts: 6, priority: 0 });
    expect(await getJob(b.id)).toMatchObject({ kind: 'email', payload: { to: { account: true } } });
  });
});
