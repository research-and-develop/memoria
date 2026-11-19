import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { all, first, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { flushDeferred, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { getGallery, getGalleryPasswordSealed } from '@/lib/db/queries/galleries';
import { listSets } from '@/lib/db/queries/photo_sets';
import { upsertSiteSetting } from '@/lib/db/queries/site_settings';
import { openGalleryPassword } from '@/lib/galleries/password';
import { suffixOf } from '@/lib/galleries/slug';
import { settingsCipher } from '@/lib/settings/secrets';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const list = await import('./route');
const one = await import('./[id]/route');
const publish = await import('./[id]/publish/route');
const unpublish = await import('./[id]/unpublish/route');
const newLink = await import('./[id]/new-link/route');

let testDb: TestDb;
let passwordHash: string;
let cookie: string;
const db = () => ({ db: testDb.db });
const SETTINGS_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
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
beforeEach(async () => {
  useTestPlatform({ db: testDb.db, env: ENV() });
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  await flushDeferred();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const create = (body: unknown, c = cookie) => list.POST(jsonRequest('/api/admin/galleries', body, { cookie: c }));
const createdId = async (body: unknown) => ((await (await create(body)).json()) as { data: { id: string; slug: string } }).data;
const audits = () => all<{ action: string; details: string }>(statement(`SELECT action, details FROM audit_log WHERE entity = 'galleries' ORDER BY created_at`), db());
type Json = { data?: Record<string, unknown>; errorCode?: string; details?: Record<string, unknown> };

describe('POST /api/admin/galleries', () => {
  it('needs a session (401) and the same origin (403)', async () => {
    expect((await create({ title: 'X' }, '')).status).toBe(401);
    const res = await list.POST(jsonRequest('/api/admin/galleries', { title: 'X' }, { cookie, headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(res.status).toBe(403);
  });

  it('creates a gallery with one set, the default look and a snapshot of the sizes; audits without personal data', async () => {
    const res = await create({ title: 'Maria & Jonas', clientName: 'Maria', clientEmail: 'Maria@Example.com', purpose: 'selection' });
    expect(res.status).toBe(201);
    const { id, slug } = ((await res.json()) as { data: { id: string; slug: string } }).data;
    expect(slug).toMatch(/^maria-jonas-[a-z2-9]{10}$/);
    const row = await getGallery(id, db());
    expect(row).toMatchObject({ title: 'Maria & Jonas', status: 'draft', access: 'link', client_email: 'Maria@example.com' });
    expect(row!.settings).toMatchObject({ theme: 'auto', accent: 'pine', font: 'classic', grid: 'masonry', sort: 'filename', processing: { display: { longEdge: 1600, quality: 75 }, watermark: null } });
    expect((await listSets(id, db())).map((s) => s.name)).toEqual(['Photos']);
    const [audit] = await audits();
    expect(audit!.action).toBe('create');
    expect(audit!.details).not.toMatch(/maria/i);
  });

  it.each([
    ['title', { title: '' }],
    ['clientEmail', { title: 'A', clientEmail: 'not-an-address' }],
    ['password', { title: 'A', access: 'password', password: 'short' }],
    ['display', { title: 'A', display: { longEdge: 700, quality: 75 }, thumb: { longEdge: 800, quality: 70 } }],
    ['accent', { title: 'A', accent: 'neon' }],
    ['slugBase', { title: 'A', slugBase: 'Bad Slug' }],
  ])('refuses a bad %s (400, nothing written)', async (field, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).details).toMatchObject({ field });
    expect(await first(statement('SELECT 1 FROM galleries'), db())).toBeNull();
  });

  it('seals a password (it opens only for this gallery) and never audits it', async () => {
    const { id } = await createdId({ title: 'Secret', access: 'password', password: 'maple-river-42' });
    const sealed = await getGalleryPasswordSealed(id, db());
    expect(sealed).toMatch(/^v1:/);
    const cipher = await settingsCipher(Uint8Array.from(atob(SETTINGS_KEY), (c) => c.charCodeAt(0)));
    expect(await openGalleryPassword(cipher, id, sealed!)).toBe('maple-river-42');
    expect(await openGalleryPassword(cipher, crypto.randomUUID(), sealed!)).toBeNull();
    expect(JSON.stringify(await audits())).not.toContain('maple');
  });

  it('a password gallery without the settings key: 503 SETTINGS_KEY_MISSING', async () => {
    useTestPlatform({ db: testDb.db, env: ENV({ SETTINGS_ENCRYPTION_KEY: '' }) });
    const res = await create({ title: 'Secret', access: 'password', password: 'maple-river-42' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as Json).errorCode).toBe('SETTINGS_KEY_MISSING');
  });

  it('snapshots the studio watermark when asked, and refuses when there is none', async () => {
    expect(((await (await create({ title: 'A', watermark: true })).json()) as Json).errorCode).toBe('WATERMARK_NONE');
    const text = { kind: 'text', text: '© North Light', font: 'sans', ink: 'light', position: 'tiled', size: 20, opacity: 60, margin: 3 };
    await upsertSiteSetting('watermark', text, db());
    const { id } = await createdId({ title: 'A', watermark: true });
    const view = ((await (await one.GET(jsonRequest(`/api/admin/galleries/${id}`, undefined, { cookie }), params({ id }))).json()) as Json).data!;
    expect(view.watermark).toEqual(text);
    expect(view.imageUrl).toBeNull();
    expect(view).not.toHaveProperty('password_sealed');
  });
});

describe('GET /api/admin/galleries', () => {
  it('lists newest first and keeps deleted galleries apart', async () => {
    const a = await createdId({ title: 'First' });
    const b = await createdId({ title: 'Second' });
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), a.id]), db());
    const res = await list.GET(jsonRequest('/api/admin/galleries', undefined, { cookie }));
    const body = (await res.json()) as { data: { id: string; coverUrl: string | null }[]; next: string | null };
    expect(body.data.map((g) => g.id)).toEqual([b.id]);
    expect(body.next).toBeNull();
    const deleted = (await (await list.GET(jsonRequest('/api/admin/galleries?deleted=1', undefined, { cookie }))).json()) as { data: { id: string }[] };
    expect(deleted.data.map((g) => g.id)).toEqual([a.id]);
    expect((await list.GET(jsonRequest('/api/admin/galleries?cursor=nope', undefined, { cookie }))).status).toBe(400);
  });
});

describe('the [id] routes', () => {
  const patch = (id: string, body: unknown) => one.PATCH(jsonRequest(`/api/admin/galleries/${id}`, body, { method: 'PATCH', cookie }), params({ id }));

  it('404 for a bad or unknown id and for a deleted gallery', async () => {
    expect((await one.GET(jsonRequest('/api/admin/galleries/x', undefined, { cookie }), params({ id: 'x' }))).status).toBe(404);
    const { id } = await createdId({ title: 'A' });
    expect((await patch(crypto.randomUUID(), { title: 'B' })).status).toBe(404);
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]), db());
    expect((await patch(id, { title: 'B' })).status).toBe(404);
  });

  it('PATCH changes only what was sent, bumps the content version, keeps the slug random part', async () => {
    const { id, slug } = await createdId({ title: 'A', accent: 'rose' });
    const res = await patch(id, { title: 'Renamed', theme: 'dark', slugBase: 'new-name' });
    expect(res.status).toBe(200);
    const row = (await getGallery(id, db()))!;
    expect(row).toMatchObject({ title: 'Renamed', content_version: 2, slug: `new-name-${suffixOf(slug)}` });
    expect(row.settings).toMatchObject({ theme: 'dark', accent: 'rose' });
    expect((await patch(id, { slug: 'anything-at-all' })).status).toBe(400);
    expect((await patch(id, { processing: {} })).status).toBe(400);
    expect((await patch(id, { purpose: 'sharing' })).status).toBe(400);
  });

  it('PATCH to password access seals it and bumps password_version; back to link clears it', async () => {
    const { id } = await createdId({ title: 'A' });
    expect((await patch(id, { access: 'password', password: 'tulip-stone-77' })).status).toBe(200);
    expect(await getGallery(id, db())).toMatchObject({ access: 'password', password_version: 2 });
    expect((await patch(id, { slug: 'my-own-address' })).status).toBe(200);
    expect((await getGallery(id, db()))!.slug).toBe('my-own-address');
    expect((await patch(id, { access: 'link' })).status).toBe(200);
    const row = (await getGallery(id, db()))!;
    expect(row.access).toBe('link');
    expect(row.slug).toMatch(/^my-own-address-[a-z2-9]{10}$/);
    expect(await getGalleryPasswordSealed(id, db())).toBeNull();
  });

  it('a slug another gallery holds: 409 SLUG_TAKEN', async () => {
    const a = await createdId({ title: 'A', access: 'password', password: 'tulip-stone-77' });
    await createdId({ title: 'B', access: 'password', password: 'tulip-stone-77' });
    const other = await createdId({ title: 'C', access: 'password', password: 'tulip-stone-77' });
    await patch(other.id, { slug: 'taken-address' });
    const res = await patch(a.id, { slug: 'taken-address' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).errorCode).toBe('SLUG_TAKEN');
  });

  it('publish and unpublish once each; repeats write nothing', async () => {
    const { id } = await createdId({ title: 'A' });
    const call = (route: typeof publish) => route.POST(jsonRequest(`/api/admin/galleries/${id}/x`, {}, { cookie }), params({ id }));
    expect((await call(publish)).status).toBe(200);
    expect((await call(publish)).status).toBe(200);
    expect(await getGallery(id, db())).toMatchObject({ status: 'published', content_version: 2 });
    await call(unpublish);
    expect(await getGallery(id, db())).toMatchObject({ status: 'draft', content_version: 3 });
    const events = (await audits()).map((a) => JSON.parse(a.details).event).filter(Boolean);
    expect(events).toEqual(['publish', 'unpublish']);
  });

  it('new link replaces the random part and the old address stops', async () => {
    const { id, slug } = await createdId({ title: 'A' });
    const res = await newLink.POST(jsonRequest(`/api/admin/galleries/${id}/new-link`, {}, { cookie }), params({ id }));
    const fresh = ((await res.json()) as { data: { slug: string } }).data.slug;
    expect(fresh).not.toBe(slug);
    expect(fresh.startsWith('a-')).toBe(true);
    expect((await getGallery(id, db()))!.slug).toBe(fresh);
  });
});
