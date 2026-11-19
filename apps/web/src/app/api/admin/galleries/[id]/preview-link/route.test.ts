import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { batch, run } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { hashPassword } from '@/lib/auth/password';
import { insertGalleryStatement, softDeleteGalleryStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { deriveGalleryKeys } from '@/lib/edge/gallery/access';
import type { EdgeGalleryDeps } from '@/lib/edge/gallery/deps';
import { NO_CACHE } from '@/lib/edge/gallery/deps';
import { handleGalleryRequest } from '@/lib/edge/gallery/handler';
import { GALLERY_MARKERS, GALLERY_PAGES } from '@/lib/edge/gallery/markers.mjs';
import { galleryRoute } from '@/lib/edge/routes';
import { adminCookie, jsonRequest, params } from '@/lib/testing/routeHarness';
import { TEST_TOTP_KEY_B64 } from '@/lib/testing/twoFactorHarness';

const { POST } = await import('./route');

/** *View as client* links (plan p06 D6.11): admin only; the link opens the draft through the handler. */
const SECRET = new Uint8Array(32).fill(3);
const SHELL = `<!DOCTYPE html>${GALLERY_MARKERS.html}><head>${GALLERY_MARKERS.head}</head><body>${GALLERY_MARKERS.root}></div>${GALLERY_MARKERS.bodyEnd}</html>`;

let testDb: TestDb;
let passwordHash: string;
let cookie: string;

beforeAll(async () => {
  testDb = await createTestDb();
  passwordHash = await hashPassword('a-long-test-password-123', 1_000);
});
beforeEach(async () => {
  useTestPlatform({
    db: testDb.db,
    env: {
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD_HASH: passwordHash,
      HASH_SALT: 'salt',
      TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64,
      SETTINGS_ENCRYPTION_KEY: btoa(String.fromCharCode(...SECRET)),
    },
  });
  cookie = await adminCookie(passwordHash, testDb.db);
});
afterEach(async () => {
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function draft() {
  const g = galleryInsert();
  await batch([insertGalleryStatement(g), insertSetStatement({ id: uuid('5e7'), galleryId: g.id, name: 'Photos', now: at(0) })], { db: testDb.db });
  return g;
}

const mint = (id: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  POST(jsonRequest(`/api/admin/galleries/${id}/preview-link`, {}, { cookie: init.cookie ?? cookie, headers: init.headers }), params({ id }));

async function openThroughHandler(path: string) {
  const req = new Request(`https://gallery.example.test${path}`);
  const route = galleryRoute(new URL(req.url).pathname, req.method)!;
  const deps: EdgeGalleryDeps = {
    db: testDb.db,
    assets: async (p) => (p === GALLERY_PAGES.shell ? new Response(SHELL) : new Response('nf', { status: 200 })),
    cache: NO_CACHE,
    config: { mediaBaseUrl: null, keys: await deriveGalleryKeys(SECRET), turnstileSiteKey: '', appName: 'Studio', isDevelopment: false },
    now: () => new Date(),
    waitUntil: () => {},
  };
  return handleGalleryRequest(req, route, deps);
}

describe('POST /api/admin/galleries/[id]/preview-link', () => {
  it('needs a session (401) and the same origin (403)', async () => {
    const g = await draft();
    expect((await mint(g.id, { cookie: '' })).status).toBe(401);
    expect((await mint(g.id, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  });

  it('returns a link the gallery handler accepts for the draft, for one hour', async () => {
    const g = await draft();
    const res = await mint(g.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { data } = (await res.json()) as { data: { url: string; expiresAt: string } };
    expect(data.url).toMatch(new RegExp(`^/g/${g.slug}\\?preview=\\d+\\.[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(data.expiresAt) - Date.now()).toBeGreaterThan(3590_000);
    expect((await openThroughHandler(data.url)).status).toBe(200);
    expect((await openThroughHandler(`/g/${g.slug}`)).status).toBe(404);
  });

  it('a deleted gallery or an id that is no uuid → 404', async () => {
    const g = await draft();
    await run(softDeleteGalleryStatement({ id: g.id, now: at(1) }), { db: testDb.db });
    expect((await mint(g.id)).status).toBe(404);
    expect((await mint('not-a-uuid')).status).toBe(404);
  });

  it('without SETTINGS_ENCRYPTION_KEY → 503', async () => {
    const g = await draft();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useTestPlatform({
      db: testDb.db,
      env: { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD_HASH: passwordHash, HASH_SALT: 'salt', TOTP_ENCRYPTION_KEY: TEST_TOTP_KEY_B64 },
    });
    expect((await mint(g.id)).status).toBe(503);
  });
});
