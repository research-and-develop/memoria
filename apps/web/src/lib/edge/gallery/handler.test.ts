import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { batch, run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import type { Db } from '@repo/platform/ports';

import { bumpContentStatement, insertGalleryStatement, publishStatement, setCoverStatement, softDeleteGalleryStatement, updateGalleryStatement } from '../../db/queries/galleries';
import { at, galleryInsert, photoUpload, uuid } from '../../db/queries/galleries/testFixtures';
import type { GalleryInsert } from '../../db/queries/galleries/types';
import { insertSetStatement } from '../../db/queries/photo_sets';
import { insertUploadingPhotoStatement, markReadyStatement, resortStatement } from '../../db/queries/photos';
import { upsertSiteSettingStatement } from '../../db/queries/site_settings';
import { CURSOR_MAX, encodeCursor } from '../../galleries/sortKey';
import { galleryRoute } from '../routes';
import { VISITOR_COOKIE, accessCookieName, deriveGalleryKeys, mintVisitorCookie, signAccessCookie, signPreviewToken, type GalleryKeys } from './access';
import type { EdgeGalleryDeps, JsonCache } from './deps';
import { galleryCacheKey, handleGalleryRequest } from './handler';
import { VIEW_SCRIPT_ID } from './inject';
import { GALLERY_MARKERS, GALLERY_PAGES } from './markers.mjs';
import type { GalleryGateView, GalleryPageView, ViewPage } from './view';

/**
 * The gallery handler on a test D1 with a fake assets fetcher and an in-memory cache (plan p06 Tests →
 * handler.test.ts): access, the view, the cache, cookies, headers, errors.
 */
const SHELL = [
  '<!DOCTYPE html>',
  `${GALLERY_MARKERS.html} class="fonts">`,
  `<head><meta name="viewport" content="width=device-width"/>${GALLERY_MARKERS.head}</head>`,
  `<body>${GALLERY_MARKERS.root} class="g"><main id="gallery"></main></div>`,
  `${GALLERY_MARKERS.bodyEnd}</html>`,
].join('');
const NOT_FOUND = '<html><title>Page not found</title></html>';
const UNAVAILABLE = '<html><title>Not available right now</title></html>';
const MEDIA = 'https://media.example.test';
const NOW = new Date('2026-11-19T10:00:00.000Z');

let testDb: TestDb;
let keys: GalleryKeys;

beforeAll(async () => {
  testDb = await createTestDb();
  keys = await deriveGalleryKeys(new Uint8Array(32).fill(7));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const opts = () => ({ db: testDb.db });

/** The Cache API's behaviour that matters: what is stored is what `match` returns (a copy). */
function memoryCache(): JsonCache & { entries: Map<string, Response> } {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: async (key) => entries.get(key)?.clone(),
    put: async (key, response) => {
      entries.set(key, response.clone());
    },
  };
}

/** A Db that counts what the handler runs. */
function countingDb(db: Db) {
  const calls = { batch: 0, all: 0, first: 0 };
  const wrapped: Db = {
    batch: (s) => (calls.batch++, db.batch(s)),
    all: (s) => (calls.all++, db.all(s)),
    first: (s) => (calls.first++, db.first(s)),
    run: (s) => db.run(s),
  };
  return { db: wrapped, calls };
}

type Setup = {
  deps: EdgeGalleryDeps;
  cache: ReturnType<typeof memoryCache>;
  calls: ReturnType<typeof countingDb>['calls'];
  settle: () => Promise<void>;
};

function setup(over: { keys?: GalleryKeys | null; pages?: Partial<Record<string, string>>; db?: Db } = {}): Setup {
  const pages: Record<string, string | undefined> = {
    [GALLERY_PAGES.shell]: SHELL,
    [GALLERY_PAGES.notFound]: NOT_FOUND,
    [GALLERY_PAGES.unavailable]: UNAVAILABLE,
    ...over.pages,
  };
  const cache = memoryCache();
  const { db, calls } = countingDb(over.db ?? testDb.db);
  const pending: Promise<unknown>[] = [];
  return {
    cache,
    calls,
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
    deps: {
      db,
      assets: async (path) => {
        const body = pages[path];
        return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
      },
      cache,
      config: { mediaBaseUrl: MEDIA, keys: over.keys === undefined ? keys : over.keys, turnstileSiteKey: 'site-key', appName: 'Memoria', isDevelopment: false },
      now: () => NOW,
      waitUntil: (p) => {
        pending.push(p);
      },
    },
  };
}

async function newGallery(over: Partial<GalleryInsert> & { publish?: boolean } = {}) {
  const { publish = true, ...insert } = over;
  const g = galleryInsert({ settings: { sort: 'filename', theme: 'dark', accent: 'pine', font: 'modern', welcome: 'Welcome!' }, ...insert });
  const setId = uuid('5e7');
  await batch(
    [insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) }), ...(publish ? [publishStatement({ id: g.id, now: at(0) })] : [])],
    opts(),
  );
  return { ...g, setId };
}

async function readyPhoto(galleryId: string, setId: string, nameKey: string) {
  const p = photoUpload(galleryId, setId, { nameKey });
  await batch([insertUploadingPhotoStatement(p), markReadyStatement({ galleryId, id: p.id, batchNow: at(1) })], opts());
  return p.id;
}

function request(path: string, init: { cookie?: string; method?: string } = {}) {
  return new Request(`https://gallery.example.test${path}`, { method: init.method ?? 'GET', headers: init.cookie ? { cookie: init.cookie } : {} });
}

async function handle(s: Setup, path: string, init: { cookie?: string; method?: string } = {}) {
  const req = request(path, init);
  const route = galleryRoute(new URL(req.url).pathname, req.method);
  if (!route) throw new Error(`not a gallery route: ${path}`);
  const res = await handleGalleryRequest(req, route, s.deps);
  await s.settle();
  return res;
}

function viewOf(html: string): GalleryPageView | GalleryGateView {
  const open = `<script id="${VIEW_SCRIPT_ID}" type="application/json">`;
  const start = html.indexOf(open);
  if (start === -1) throw new Error('no view script');
  return JSON.parse(html.slice(start + open.length, html.indexOf('</script>', start)));
}

const quiet = () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return error;
};

describe('a published link gallery', () => {
  it('answers the shell with the view injected, the theme attributes and an mv cookie', async () => {
    const g = await newGallery();
    const a = await readyPhoto(g.id, g.setId, 'a');
    const s = setup();
    const res = await handle(s, `/g/${g.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en-GB" data-gallery-theme="dark" class="fonts">');
    expect(html).toContain(`${GALLERY_MARKERS.root} data-gallery-theme="dark" data-gallery-accent="pine" data-gallery-font="modern" class="g">`);
    expect(html).toContain(`<title>${g.title.replace('&', '&amp;')}</title>`);
    const view = viewOf(html) as GalleryPageView;
    expect(view).toMatchObject({ kind: 'gallery', gallery: { id: g.id, welcome: 'Welcome!' }, media: MEDIA, sets: [{ id: g.setId, name: 'Photos' }] });
    expect(view.page?.photos.map((p) => p[0])).toEqual([a]);
    expect(html).not.toMatch(/original|maria@example\.com|Maria"/);
    expect(res.headers.get('set-cookie')).toMatch(/^mv=v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
  });

  it('sets the gallery headers (D6.13)', async () => {
    const g = await newGallery();
    const res = await handle(setup(), `/g/${g.slug}`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/img-src [^;]*https:\/\/media\.example\.test/);
    expect(csp).toMatch(/script-src [^;]*'unsafe-inline'[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com/);
    expect(csp).not.toMatch(/cloudflareinsights|r2\.cloudflarestorage/);
  });

  it('does not re-mint a valid mv cookie', async () => {
    const g = await newGallery();
    const mv = await mintVisitorCookie(keys.visitor);
    const res = await handle(setup(), `/g/${g.slug}`, { cookie: `${VISITOR_COOKIE}=${mv}` });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('ignores unknown query parameters (cpu_probe)', async () => {
    const g = await newGallery();
    expect((await handle(setup(), `/g/${g.slug}?cpu_probe=1&x=2`)).status).toBe(200);
  });

  it('answers HEAD without a body', async () => {
    const g = await newGallery();
    const res = await handle(setup(), `/g/${g.slug}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('links the cover display copy as og:image', async () => {
    const g = await newGallery();
    const photoId = await readyPhoto(g.id, g.setId, 'a');
    await run(setCoverStatement({ galleryId: g.id, photoId, now: at(2) }), opts());
    const html = await (await handle(setup(), `/g/${g.slug}`)).text();
    expect(html).toContain(`<meta property="og:image" content="${MEDIA}/galleries/${g.id}/${photoId}/abcd2345/display.webp"/>`);
  });
});

describe('not found', () => {
  it.each([
    ['an unknown slug', async () => 'no-such-gallery'],
    ['a draft without a preview', async () => (await newGallery({ publish: false })).slug],
    [
      'a deleted gallery',
      async () => {
        const g = await newGallery();
        await run(softDeleteGalleryStatement({ id: g.id, now: at(3) }), opts());
        return g.slug;
      },
    ],
  ])('%s → the 404 page', async (_label, slugOf) => {
    const res = await handle(setup(), `/g/${await slugOf()}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('previews (D6.11)', () => {
  it('a valid preview token opens a draft, a password draft too', async () => {
    for (const access of ['link', 'password'] as const) {
      const g = await newGallery({ publish: false, access, passwordSealed: access === 'password' ? 'sealed' : null });
      const token = await signPreviewToken(keys.preview, { galleryId: g.id, now: NOW });
      const res = await handle(setup(), `/g/${g.slug}?preview=${token}`);
      expect(res.status).toBe(200);
      expect(viewOf(await res.text()).kind).toBe('gallery');
    }
  });

  it("refuses an expired token or another gallery's", async () => {
    const g = await newGallery({ publish: false });
    const other = await newGallery({ publish: false });
    const expired = await signPreviewToken(keys.preview, { galleryId: g.id, now: new Date(NOW.getTime() - 3601_000) });
    const foreign = await signPreviewToken(keys.preview, { galleryId: other.id, now: NOW });
    expect((await handle(setup(), `/g/${g.slug}?preview=${expired}`)).status).toBe(404);
    expect((await handle(setup(), `/g/${g.slug}?preview=${foreign}`)).status).toBe(404);
  });

  it("is ignored on a published password gallery (the gate stays)", async () => {
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    const token = await signPreviewToken(keys.preview, { galleryId: g.id, now: NOW });
    expect(viewOf(await (await handle(setup(), `/g/${g.slug}?preview=${token}`)).text()).kind).toBe('gate');
  });
});

describe('a password gallery', () => {
  const cookieFor = async (galleryId: string, passwordVersion = 1) =>
    `${accessCookieName(galleryId)}=${await signAccessCookie(keys.access, { galleryId, passwordVersion, now: NOW })}`;

  it('without a cookie → the gate: no photos, no cover, no og:image, an mv cookie', async () => {
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    const photoId = await readyPhoto(g.id, g.setId, 'a');
    await run(setCoverStatement({ galleryId: g.id, photoId, now: at(2) }), opts());
    const res = await handle(setup(), `/g/${g.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(viewOf(html)).toEqual({
      v: 1,
      kind: 'gate',
      gallery: { slug: g.slug, title: g.title, theme: 'dark', accent: 'pine', font: 'modern' },
      studio: { name: 'Memoria', website: null, locale: 'en-GB', timeZone: 'UTC' },
      turnstileSiteKey: 'site-key',
    });
    expect(html).not.toContain(photoId);
    expect(html).not.toContain('og:image');
    expect(res.headers.get('set-cookie')).toMatch(/^mv=/);
  });

  it('with a valid cookie → the gallery; with an old version or another gallery\'s → the gate', async () => {
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    const other = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    expect(viewOf(await (await handle(setup(), `/g/${g.slug}`, { cookie: await cookieFor(g.id) })).text()).kind).toBe('gallery');
    // A password change: password_version 1 → 2.
    await run(statement('UPDATE galleries SET password_version = 2 WHERE id = ?', [g.id]), opts());
    expect(viewOf(await (await handle(setup(), `/g/${g.slug}`, { cookie: await cookieFor(g.id) })).text()).kind).toBe('gate');
    // B's cookie value under A's cookie name.
    const foreign = `${accessCookieName(g.id)}=${(await cookieFor(other.id, 2)).split('=')[1]}`;
    expect(viewOf(await (await handle(setup(), `/g/${g.slug}`, { cookie: foreign })).text()).kind).toBe('gate');
  });

  it('/data without a cookie → 401 JSON', async () => {
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    const res = await handle(setup(), `/g/${g.slug}/data?set=${g.setId}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Enter the gallery password.', errorCode: 'GALLERY_LOCKED' });
  });
});

describe('without the derived keys', () => {
  it('a link gallery still opens, without an mv cookie', async () => {
    const g = await newGallery();
    const res = await handle(setup({ keys: null }), `/g/${g.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a password gallery → the 503 page, logged gallery_key_missing', async () => {
    const error = quiet();
    const g = await newGallery({ access: 'password', passwordSealed: 'sealed' });
    const res = await handle(setup({ keys: null }), `/g/${g.slug}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE);
    expect(JSON.stringify(error.mock.calls)).toContain('gallery_key_missing');
  });
});

describe('the studio', () => {
  it('a rename shows at once, without a content_version change (the cached photos stay)', async () => {
    const g = await newGallery();
    const s = setup();
    await handle(s, `/g/${g.slug}`);
    await run(upsertSiteSettingStatement('studio', { name: 'North Light', siteUrl: null }), opts());
    const res = await handle(s, `/g/${g.slug}`);
    expect(res.headers.get('x-gallery-cache')).toBe('hit');
    const html = await res.text();
    expect(viewOf(html).studio.name).toBe('North Light');
    expect(html).toContain('<meta property="og:description" content="North Light"/>');
  });
});

describe('the cache (D6.8)', () => {
  it('stores the first view under …/first/start as an internal public response, without a cookie', async () => {
    const g = await newGallery();
    const s = setup();
    const res = await handle(s, `/g/${g.slug}`);
    expect(res.headers.get('x-gallery-cache')).toBe('miss');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('set-cookie')).toMatch(/^mv=/);
    const key = `https://cache.internal/g/${g.id}/1/first/start`;
    expect(galleryCacheKey({ id: g.id, content_version: 1 }, 'first', null)).toBe(key);
    const entry = s.cache.entries.get(key);
    expect(entry?.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(entry?.headers.get('set-cookie')).toBeNull();
  });

  it('a hit reads only the two rows of the batch', async () => {
    const g = await newGallery();
    const s = setup();
    await handle(s, `/g/${g.slug}`);
    s.calls.batch = 0;
    s.calls.all = 0;
    const res = await handle(s, `/g/${g.slug}`);
    expect(res.headers.get('x-gallery-cache')).toBe('hit');
    expect(s.calls).toEqual({ batch: 1, all: 0, first: 0 });
  });

  it('a new content_version misses', async () => {
    const g = await newGallery();
    const s = setup();
    await handle(s, `/g/${g.slug}`);
    const b = await readyPhoto(g.id, g.setId, 'b');
    await run(bumpContentStatement({ id: g.id, now: at(4) }), opts());
    const res = await handle(s, `/g/${g.slug}`);
    expect(res.headers.get('x-gallery-cache')).toBe('miss');
    expect((viewOf(await res.text()) as GalleryPageView).page?.photos.map((p) => p[0])).toEqual([b]);
  });
});

describe('/g/<slug>/data', () => {
  const page = async (res: Response) => ((await res.json()) as { data: ViewPage }).data;

  it("answers a set's page as { data }, private for 60 s, with an mv cookie", async () => {
    const g = await newGallery();
    const a = await readyPhoto(g.id, g.setId, 'a');
    const res = await handle(setup(), `/g/${g.slug}/data?set=${g.setId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('set-cookie')).toMatch(/^mv=.*; Path=\//);
    expect(await page(res)).toEqual({ setId: g.setId, photos: [[a, 1600, 1067, expect.any(String), 'abcd2345', 'webp']], next: null });
  });

  it('answers an empty set of this gallery with an empty page', async () => {
    const g = await newGallery();
    expect(await page(await handle(setup(), `/g/${g.slug}/data?set=${g.setId}`))).toEqual({ setId: g.setId, photos: [], next: null });
  });

  it("refuses another gallery's set, also on a cache miss (the join)", async () => {
    const g = await newGallery();
    const other = await newGallery();
    await readyPhoto(other.id, other.setId, 'a');
    const s = setup();
    const res = await handle(s, `/g/${g.slug}/data?set=${other.setId}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'This gallery or page does not exist.', errorCode: 'NOT_FOUND' });
    expect(s.cache.entries.size).toBe(0);
  });

  it.each([
    ['no set', ''],
    ['a set that is no uuid', '?set=abc'],
  ])('%s → 404', async (_label, query) => {
    const g = await newGallery();
    expect((await handle(setup(), `/g/${g.slug}/data${query}`)).status).toBe(404);
  });

  it('accepts a 700-character cursor, refuses 701 or a malformed one', async () => {
    const g = await newGallery();
    const cursor = (n: number) => 'A'.repeat(n);
    expect(CURSOR_MAX).toBe(700);
    expect((await handle(setup(), `/g/${g.slug}/data?set=${g.setId}&cursor=${cursor(700)}`)).status).toBe(200);
    expect((await handle(setup(), `/g/${g.slug}/data?set=${g.setId}&cursor=${cursor(701)}`)).status).toBe(404);
    expect((await handle(setup(), `/g/${g.slug}/data?set=${g.setId}&cursor=a.b`)).status).toBe(404);
  });

  it('pages a large set by sort_key cursors, in either sort, every photo once', async () => {
    const g = await newGallery();
    // 502 ready photos in one statement: name order = n, taken order = reversed.
    await run(
      statement(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 502)
         INSERT INTO photos (id, gallery_id, set_id, filename, name_key, taken_key, sort_key, content_type, original_bytes, bytes, width, height,
           sha256, rev, derivative_ext, display_width, display_height, color, processing, status, updated_at)
         SELECT printf('9d070500-0000-4000-8000-%012d', i), ?, ?, printf('IMG_%04d.jpg', i), printf('img_%010d', i),
           printf('2026-10-03T%02d:%02d', 23 - (i / 60), 59 - (i % 60)), 'x', 'image/jpeg', 1, 1, 6000, 4000,
           printf('%064x', i), 'abcd2345', 'webp', 1600, 1067, '#7A6B5C', '{}', 'ready', ?
         FROM n`,
        [g.id, g.setId, at(1)],
      ),
      opts(),
    );
    async function all(sort: 'filename' | 'taken') {
      await batch(
        [updateGalleryStatement({ id: g.id, patch: { settingsPatch: { sort } }, now: at(5) }), resortStatement(g.id), bumpContentStatement({ id: g.id, now: at(5) })],
        opts(),
      );
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 5; i++) {
        const res: Response = await handle(setup(), `/g/${g.slug}/data?set=${g.setId}${cursor ? `&cursor=${cursor}` : ''}`);
        const data: ViewPage = await page(res);
        ids.push(...data.photos.map((p) => p[0]));
        cursor = data.next;
        if (!cursor) break;
      }
      return ids;
    }
    const byName = await all('filename');
    expect(byName).toHaveLength(502);
    expect(new Set(byName).size).toBe(502);
    expect(byName[0]).toBe('9d070500-0000-4000-8000-000000000001');
    const byTaken = await all('taken');
    expect(byTaken).toHaveLength(502);
    expect(byTaken).toEqual([...byName].reverse());
  });

  it('caches a further page under …/<setId>/<cursor>', async () => {
    const g = await newGallery();
    const s = setup();
    const cursor = encodeCursor('a');
    await handle(s, `/g/${g.slug}/data?set=${g.setId}&cursor=${cursor}`);
    expect([...s.cache.entries.keys()]).toEqual([`https://cache.internal/g/${g.id}/1/${g.setId}/${cursor}`]);
  });
});

describe('failures', () => {
  it('a missing shell → the 503 page', async () => {
    quiet();
    const g = await newGallery();
    const res = await handle(setup({ pages: { [GALLERY_PAGES.shell]: undefined } }), `/g/${g.slug}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE);
  });

  it('a D1 error → the 503 page, logged without the slug or an id', async () => {
    const error = quiet();
    const g = await newGallery();
    const broken = { batch: async () => Promise.reject(new Error('D1_ERROR: boom')) } as unknown as Db;
    const res = await handle(setup({ db: broken }), `/g/${g.slug}`);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('gallery_unavailable');
    expect(logged).not.toContain(g.slug);
    expect(logged).not.toContain(g.id);
  });

  it('a D1 error on /data → 503 JSON', async () => {
    quiet();
    const g = await newGallery();
    const broken = { batch: async () => Promise.reject(new Error('boom')) } as unknown as Db;
    const res = await handle(setup({ db: broken }), `/g/${g.slug}/data?set=${g.setId}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The gallery is not available right now.', errorCode: 'GALLERY_UNAVAILABLE' });
  });
});
