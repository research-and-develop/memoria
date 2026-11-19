import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { all, batch, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { insertGalleryStatement, publishStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, uuid } from '@/lib/db/queries/galleries/testFixtures';
import type { GalleryInsert } from '@/lib/db/queries/galleries/types';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { accessCookieName, deriveGalleryKeys, verifyAccessCookie } from '@/lib/edge/gallery/access';
import { GATE_DAILY_NOTICE_AT, gateDailyRule } from '@/lib/galleries/gate';
import { sealGalleryPassword } from '@/lib/galleries/password';
import { windowStart } from '@/lib/security/rateLimit';
import { settingsCipher } from '@/lib/settings/secrets';
import { jsonRequest, params } from '@/lib/testing/routeHarness';

const turnstile = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; reason?: string }, calls: 0 }));
vi.mock('@/lib/turnstile/verify', () => ({
  verifyTurnstile: vi.fn(async () => {
    turnstile.calls += 1;
    return turnstile.result;
  }),
}));

const { POST } = await import('./route');

/**
 * The password gate (plan p06 D6.10): the order of its checks, the limits (IPv6 by /64), the HMAC
 * comparison, the cookie `worker.ts` accepts, and the daily notice.
 */
const SECRET = new Uint8Array(32).fill(9);
const SECRET_B64 = btoa(String.fromCharCode(...SECRET));
const PASSWORD = 'maple-river-42';
const MAIL = { MAIL_FROM: 'studio@example.com', SMTP_HOST: 'smtp.example.com' };

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
beforeEach(() => {
  useTestPlatform({ db: testDb.db, env: { SETTINGS_ENCRYPTION_KEY: SECRET_B64, TURNSTILE_SECRET_KEY: 's', HASH_SALT: 'salt', ...MAIL } });
  turnstile.result = { ok: true };
  turnstile.calls = 0;
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function passwordGallery(over: Partial<GalleryInsert> & { publish?: boolean } = {}) {
  const { publish = true, ...insert } = over;
  const id = uuid('9a11e7');
  const access = insert.access ?? 'password';
  const passwordSealed = access === 'password' ? await sealGalleryPassword(await settingsCipher(SECRET), id, PASSWORD) : null;
  const g = galleryInsert({ id, access, passwordSealed, ...insert });
  await batch(
    [insertGalleryStatement(g), insertSetStatement({ id: uuid('5e7'), galleryId: id, name: 'Photos', now: at(0) }), ...(publish ? [publishStatement({ id, now: at(0) })] : [])],
    { db: testDb.db },
  );
  return g;
}

const gate = (slug: string, body: Record<string, unknown>, init: { ip?: string; headers?: Record<string, string> } = {}) =>
  POST(jsonRequest(`/api/g/${slug}/access`, { turnstileToken: 't', ...body }, { headers: { 'cf-connecting-ip': init.ip ?? '203.0.113.7', ...init.headers } }), params({ slug }));

const emailJobs = async () =>
  (await all<{ payload: string }>(statement("SELECT payload FROM jobs WHERE kind = 'email'"), { db: testDb.db })).map((r) => JSON.parse(r.payload) as Record<string, unknown>);

describe('POST /api/g/[slug]/access', () => {
  it('the right password → 200 and an access cookie worker.ts accepts (Path=/, HttpOnly, SameSite=Lax)', async () => {
    const g = await passwordGallery();
    const res = await gate(g.slug, { password: ` ${PASSWORD}\n` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [cookie] = res.headers.getSetCookie();
    expect(cookie).toMatch(new RegExp(`^${accessCookieName(g.id)}=v1\\.1\\.\\d+\\.[A-Za-z0-9_-]{43}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax$`));
    const value = cookie!.split(';')[0]!.split('=')[1]!;
    const keys = await deriveGalleryKeys(SECRET);
    expect(await verifyAccessCookie(keys.access, value, { galleryId: g.id, passwordVersion: 1, now: new Date() })).toBe(true);
  });

  it('a wrong password → 401 with a fixed message and no cookie', async () => {
    const g = await passwordGallery();
    const res = await gate(g.slug, { password: 'maple-river-43' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'That password is not right.', errorCode: 'WRONG_PASSWORD' });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('cross-origin → 403 before anything is counted', async () => {
    const g = await passwordGallery();
    const res = await gate(g.slug, { password: PASSWORD }, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(403);
    expect(await all(statement('SELECT 1 FROM rate_limits'), { db: testDb.db })).toEqual([]);
    expect(turnstile.calls).toBe(0);
  });

  it('the per-IP counter → 429 before Turnstile is called', async () => {
    for (let i = 0; i < 30; i++) expect((await gate('no-such-gallery', { password: 'x' })).status).toBe(404);
    const calls = turnstile.calls;
    const res = await gate('no-such-gallery', { password: 'x' });
    expect(res.status).toBe(429);
    expect(turnstile.calls).toBe(calls);
  });

  it('a Turnstile failure → 403 before any password work', async () => {
    const g = await passwordGallery();
    turnstile.result = { ok: false, reason: 'rejected' };
    const res = await gate(g.slug, { password: PASSWORD });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe('TURNSTILE_FAILED');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ['an unknown slug', async () => 'no-such-gallery'],
    ['a malformed slug', async () => 'Bad_Slug'],
    ['a link gallery', async () => (await passwordGallery({ access: 'link' })).slug],
    ['a password draft', async () => (await passwordGallery({ publish: false })).slug],
  ])('%s → 404', async (_label, slugOf) => {
    expect((await gate(await slugOf(), { password: PASSWORD })).status).toBe(404);
  });

  it('no password → 400', async () => {
    const g = await passwordGallery();
    expect((await gate(g.slug, { password: '   ' })).status).toBe(400);
  });

  it('10 wrong passwords from an IP → 429, even for the right one; another IP still gets in', async () => {
    const g = await passwordGallery();
    for (let i = 0; i < 10; i++) expect((await gate(g.slug, { password: `wrong-${i}` })).status).toBe(401);
    expect((await gate(g.slug, { password: PASSWORD })).status).toBe(429);
    expect((await gate(g.slug, { password: PASSWORD }, { ip: '198.51.100.9' })).status).toBe(200);
  });

  it('two IPv6 addresses in one /64 share the failure limit, another /64 does not', async () => {
    const g = await passwordGallery();
    for (let i = 0; i < 10; i++) await gate(g.slug, { password: 'wrong' }, { ip: `2001:db8:1:2::${(i + 1).toString(16)}` });
    expect((await gate(g.slug, { password: PASSWORD }, { ip: '2001:db8:1:2:ffff::1' })).status).toBe(429);
    expect((await gate(g.slug, { password: PASSWORD }, { ip: '2001:db8:1:3::1' })).status).toBe(200);
  });

  it('the failure that reaches the daily threshold queues one security.gallery-gate notice; the next none', async () => {
    const g = await passwordGallery();
    const daily = gateDailyRule(g.id, 1);
    await run(
      statement('INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, ?)', [daily.bucket, windowStart(new Date(), daily.windowSeconds), GATE_DAILY_NOTICE_AT - 1]),
      { db: testDb.db },
    );
    expect((await gate(g.slug, { password: 'wrong' })).status).toBe(401);
    const jobs = await emailJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ template: 'security.gallery-gate', params: { gallery: g.title } });
    expect(JSON.stringify(jobs[0])).not.toContain(PASSWORD);
    await flushDeferred();
    expect(nudgeCount()).toBe(1);
    expect((await gate(g.slug, { password: 'wrong' }, { ip: '198.51.100.20' })).status).toBe(401);
    expect(await emailJobs()).toHaveLength(1);
  });

  it('a changed password (password_version + 1) ends the old cookie', async () => {
    const g = await passwordGallery();
    const [cookie] = (await gate(g.slug, { password: PASSWORD })).headers.getSetCookie();
    const value = cookie!.split(';')[0]!.split('=')[1]!;
    await run(statement('UPDATE galleries SET password_version = 2 WHERE id = ?', [g.id]), { db: testDb.db });
    const keys = await deriveGalleryKeys(SECRET);
    expect(await verifyAccessCookie(keys.access, value, { galleryId: g.id, passwordVersion: 2, now: new Date() })).toBe(false);
  });

  it('without SETTINGS_ENCRYPTION_KEY → 503', async () => {
    const g = await passwordGallery();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useTestPlatform({ db: testDb.db, env: { TURNSTILE_SECRET_KEY: 's', HASH_SALT: 'salt' } });
    expect((await gate(g.slug, { password: PASSWORD })).status).toBe(503);
  });
});
