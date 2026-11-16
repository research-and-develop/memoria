import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getJob } from '@/lib/db/queries/jobs';
import { emailJobStatement } from '@/lib/email/job';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST: sendTest } = await import('./test/route');
const { GET: getEmail } = await import('./[id]/route');
const { POST: retry } = await import('./[id]/retry/route');

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

const test = (cookie: string, body: unknown, headers?: Record<string, string>) => sendTest(jsonRequest('/api/admin/emails/test', body, { cookie, headers }));
const get = (cookie: string, id: string) => getEmail(jsonRequest(`/api/admin/emails/${id}`, undefined, { method: 'GET', cookie }), params({ id }));
const retryReq = (cookie: string, id: string) => retry(jsonRequest(`/api/admin/emails/${id}/retry`, {}, { cookie }), params({ id }));
const audits = () => all<{ entity: string; details: string }>(statement("SELECT entity, details FROM audit_log WHERE entity = 'email'"), db());

async function failedEmail(): Promise<string> {
  const now = new Date();
  const job = emailJobStatement({ template: 'test', to: { email: 'client@example.org' }, params: { queuedAt: now.toISOString() }, now });
  await run(job.statement, db());
  await run(statement(`UPDATE jobs SET status = 'failed', attempts = 6, finished_at = ?, last_error = 'SMTP_550: rejected' WHERE id = ?`, [now.toISOString(), job.id]), db());
  return job.id;
}

describe('POST /api/admin/emails/test', () => {
  it('401 without a session, 403 cross-origin, 400 for a bad address', async () => {
    expect((await test('', { to: 'me@example.com' })).status).toBe(401);
    const cookie = await adminCookie(passwordHash, testDb.db);
    expect((await test(cookie, { to: 'me@example.com' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await (await test(cookie, { to: 'nope' })).json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field: 'to' } });
  });

  it('202: one email job with one attempt, the audit without the address, one nudge, no-store', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await test(cookie, { to: ' Me@Example.com ' });
    expect(res.status).toBe(202);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { id: string } };
    expect(data).toMatchObject({ template: 'test', templateLabel: 'Test email', to: 'Me@example.com', status: 'queued', maxAttempts: 1, canRetry: false });
    expect(await getJob(data.id, db())).toMatchObject({ kind: 'email', max_attempts: 1, status: 'pending' });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).not.toMatch(/example\.com/i);
    expect(nudgeCount()).toBe(1);
  });

  it('409 MAIL_NOT_CONFIGURED when there is no way to send', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ MAIL_FROM: '', SMTP_HOST: '' }) });
    const cookie = await adminCookie(passwordHash, testDb.db);
    const res = await test(cookie, { to: 'me@example.com' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ errorCode: 'MAIL_NOT_CONFIGURED' });
  });

  it('429 at the 4th in an hour', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    for (let i = 0; i < 3; i++) expect((await test(cookie, { to: 'me@example.com' })).status).toBe(202);
    const res = await test(cookie, { to: 'me@example.com' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});

describe('GET /api/admin/emails/[id]', () => {
  it('answers an email job; 404 for a missing, non-email or non-uuid id', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const id = await failedEmail();
    expect(await (await get(cookie, id)).json()).toMatchObject({ data: { id, status: 'failed', lastError: 'SMTP_550: rejected', canRetry: true } });
    expect((await get(cookie, crypto.randomUUID())).status).toBe(404);
    expect((await get(cookie, 'not-a-uuid')).status).toBe(404);
    const other = crypto.randomUUID();
    await run(statement(`INSERT INTO jobs (id, kind, payload, max_attempts, run_after) VALUES (?, 'housekeeping', '{}', 3, ?)`, [other, new Date().toISOString()]), db());
    expect((await get(cookie, other)).status).toBe(404);
    expect((await get('', id)).status).toBe(401);
  });
});

describe('POST /api/admin/emails/[id]/retry', () => {
  it('a failed email goes back to pending with its attempts reset, audited, nudged', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const id = await failedEmail();
    const res = await retryReq(cookie, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { id, status: 'queued', attempts: 0, lastError: null } });
    expect(await getJob(id, db())).toMatchObject({ status: 'pending', attempts: 0, finished_at: null });
    expect(await audits()).toHaveLength(1);
    expect(nudgeCount()).toBe(1);
  });

  it('409 for an email that has not failed; 404 for none; no audit', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    const id = await failedEmail();
    await retryReq(cookie, id);
    const again = await retryReq(cookie, id);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ errorCode: 'EMAIL_NOT_FAILED' });
    expect((await retryReq(cookie, crypto.randomUUID())).status).toBe(404);
    expect(await audits()).toHaveLength(1);
  });

  it('429 at the 21st in an hour', async () => {
    const cookie = await adminCookie(passwordHash, testDb.db);
    for (let i = 0; i < 20; i++) await retryReq(cookie, crypto.randomUUID());
    expect((await retryReq(cookie, crypto.randomUUID())).status).toBe(429);
  });
});
