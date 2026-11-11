import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb, useTestDb, type TestDb } from '@repo/db/test-utils';

import { hashPassword } from '@/lib/auth/password';
import { listRecentAudit } from '@/lib/db/queries/audit_log';
import { createContactMessageStatement, getContactMessage } from '@/lib/db/queries/contact_messages';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';

const cf = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: cf.env, ctx: { waitUntil: () => {} } }) }));

const { GET } = await import('./route');
const { PATCH, DELETE } = await import('./[id]/route');

let testDb: TestDb;
let passwordHash: string;
let cookie: string;
const opts = () => ({ db: testDb.db });
const ID = '0b3c5d7e-1f2a-4b6c-8d9e-0f1a2b3c4d5e';

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(async () => {
  useTestDb(testDb.db);
  cf.env = { ADMIN_PASSWORD_HASH: passwordHash };
  cookie = await adminCookie(passwordHash, testDb.db);
  await createContactMessageStatement(ID, { name: 'Ada', email: 'ada@example.com', message: 'Hi', consentAt: '2026-01-01T00:00:00.000Z' }, opts()).run();
});
afterEach(async () => {
  useTestDb(null);
  await testDb.reset();
});
afterAll(() => testDb.dispose());

describe('admin inbox API', () => {
  it('refuses without a session', async () => {
    expect((await GET(jsonRequest('/api/admin/messages'))).status).toBe(401);
    expect((await DELETE(jsonRequest(`/api/admin/messages/${ID}`, undefined, { method: 'DELETE' }), params({ id: ID }))).status).toBe(401);
    expect(await getContactMessage(ID, opts())).not.toBeNull();
  });

  it('lists one page with its paging', async () => {
    const res = await GET(jsonRequest('/api/admin/messages?page=1&page_size=10', undefined, { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: [{ id: ID, name: 'Ada' }], page: 1, pageSize: 10 });
  });

  it('validates the query', async () => {
    const res = await GET(jsonRequest('/api/admin/messages?page=0', undefined, { cookie }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field: 'page' } });
  });

  it('marks read, with the audit row in the same batch', async () => {
    const res = await PATCH(jsonRequest(`/api/admin/messages/${ID}`, { isRead: true }, { method: 'PATCH', cookie }), params({ id: ID }));
    expect(res.status).toBe(200);
    expect((await getContactMessage(ID, opts()))?.is_read).toBe(true);
    expect((await listRecentAudit(5, opts()))[0]).toMatchObject({ action: 'update', entity: 'contact_messages', entity_id: ID });
  });

  it('deletes, then answers 404 for the same id and writes no second audit row', async () => {
    const del = () => DELETE(jsonRequest(`/api/admin/messages/${ID}`, undefined, { method: 'DELETE', cookie }), params({ id: ID }));
    expect((await del()).status).toBe(200);
    expect(await getContactMessage(ID, opts())).toBeNull();
    const again = await del();
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ errorCode: 'NOT_FOUND' });
    expect((await listRecentAudit(10, opts())).filter((a) => a.action === 'delete')).toHaveLength(1);
  });

  it.each([
    ['a malformed id', 'not-a-uuid', 404],
    ['an unknown id', '9b3c5d7e-1f2a-4b6c-8d9e-0f1a2b3c4d5e', 404],
  ])('answers %s with 404', async (_label, id, status) => {
    const res = await PATCH(jsonRequest(`/api/admin/messages/${id}`, { isRead: true }, { method: 'PATCH', cookie }), params({ id }));
    expect(res.status).toBe(status);
  });

  it('refuses a cross-origin write even with a valid session (CSRF)', async () => {
    const res = await DELETE(
      jsonRequest(`/api/admin/messages/${ID}`, undefined, { method: 'DELETE', cookie, headers: { 'sec-fetch-site': 'cross-site' } }),
      params({ id: ID }),
    );
    expect(res.status).toBe(403);
    expect(await getContactMessage(ID, opts())).not.toBeNull();
  });
});
