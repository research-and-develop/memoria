import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb, useTestDb, type TestDb } from '@repo/db/test-utils';

import { listContactMessages } from '@/lib/db/queries/contact_messages';
import { atFixedTime, jsonRequest } from '@/lib/testing/routeHarness';

// Mock only the edges: the Cloudflare context and Turnstile. The database is real (an in-memory D1).
const cf = vi.hoisted(() => ({ env: {} as Record<string, unknown>, waitUntil: [] as Promise<unknown>[] }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: cf.env, ctx: { waitUntil: (p: Promise<unknown>) => cf.waitUntil.push(p) } }),
}));
const turnstile = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; reason?: string } }));
vi.mock('@/lib/turnstile/verify', () => ({ verifyTurnstile: vi.fn(async () => turnstile.result) }));

const { POST } = await import('./route');

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => {
  useTestDb(testDb.db);
  turnstile.result = { ok: true };
  cf.waitUntil = [];
  cf.env = { TURNSTILE_SECRET_KEY: 'secret', HASH_SALT: 'salt' };
});
afterEach(async () => {
  await Promise.allSettled(cf.waitUntil);
  useTestDb(null);
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const message = (overrides: Record<string, unknown> = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  message: 'Hello!',
  consent: true,
  website: '',
  turnstileToken: 'token',
  ...overrides,
});

const stored = () => listContactMessages({ limit: 10, offset: 0 }, opts());

describe('POST /api/contact', () => {
  it('stores the message and answers 201 with its id', async () => {
    const res = await POST(jsonRequest('/api/contact', message()));
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    expect(await stored()).toEqual([expect.objectContaining({ id: data.id, name: 'Ada Lovelace', email: 'ada@example.com', is_read: false })]);
  });

  it.each([
    ['invalid fields', message({ email: 'x' }), 'email'],
    ['no consent', message({ consent: false }), 'consent'],
  ])('refuses %s and stores nothing', async (_label, body, field) => {
    const res = await POST(jsonRequest('/api/contact', body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'INVALID_PARAMS', details: { field } });
    expect(await stored()).toEqual([]);
  });

  it('refuses a failed Turnstile check before any write', async () => {
    turnstile.result = { ok: false, reason: 'rejected' };
    const res = await POST(jsonRequest('/api/contact', message()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errorCode: 'TURNSTILE_FAILED' });
    expect(await stored()).toEqual([]);
  });

  it('answers a bot that fills the honeypot like a success, storing nothing', async () => {
    const res = await POST(jsonRequest('/api/contact', message({ website: 'http://spam.example' })));
    expect(res.status).toBe(201);
    expect(await stored()).toEqual([]);
  });

  it('rate-limits one visitor after 5 messages an hour', async () => {
    const headers = { 'cf-connecting-ip': '203.0.113.9' };
    const res = await atFixedTime(async () => {
      for (let i = 0; i < 5; i++) expect((await POST(jsonRequest('/api/contact', message(), { headers }))).status).toBe(201);
      return POST(jsonRequest('/api/contact', message(), { headers }));
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await stored()).toHaveLength(5);
  });

  it('refuses a cross-site post', async () => {
    expect((await POST(jsonRequest('/api/contact', message(), { headers: { 'sec-fetch-site': 'cross-site' } }))).status).toBe(403);
  });
});
