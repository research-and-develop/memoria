import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { batch } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { insertGalleryStatement, publishStatement } from '@/lib/db/queries/galleries';
import { at, galleryInsert, uuid } from '@/lib/db/queries/galleries/testFixtures';
import { insertSetStatement } from '@/lib/db/queries/photo_sets';
import { GALLERY_MARKERS } from '@/lib/edge/gallery/markers.mjs';

import { GET as dataGET } from './data/route';
import { GET, HEAD } from './route';

/**
 * The development hosts of the gallery handler (plan p06 D6.5): 404 unless NEXTJS_ENV=development;
 * in development, the same handler with the shell from Next's `/gallery-shell` page.
 */
const SHELL = `<!DOCTYPE html>${GALLERY_MARKERS.html}><head>${GALLERY_MARKERS.head}</head><body>${GALLERY_MARKERS.root}></div>${GALLERY_MARKERS.bodyEnd}</html>`;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  resetTestPlatform();
  vi.unstubAllGlobals();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

async function publishedGallery() {
  const g = galleryInsert();
  const setId = uuid('5e7');
  await batch(
    [insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) }), publishStatement({ id: g.id, now: at(0) })],
    { db: testDb.db },
  );
  return { ...g, setId };
}

describe('the development gallery routes', () => {
  it.each([undefined, 'production'])('answer 404 when NEXTJS_ENV is %s', async (value) => {
    useTestPlatform({ db: testDb.db, env: { NEXTJS_ENV: value } });
    const g = await publishedGallery();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const page = await GET(new Request(`http://localhost:3210/g/${g.slug}`) as never);
    const data = await dataGET(new Request(`http://localhost:3210/g/${g.slug}/data?set=${g.setId}`) as never);
    expect(page.status).toBe(404);
    expect(data.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('in development, serve the gallery through the shared handler', async () => {
    useTestPlatform({ db: testDb.db, env: { NEXTJS_ENV: 'development', SETTINGS_ENCRYPTION_KEY: KEY } });
    const g = await publishedGallery();
    const fetchSpy = vi.fn(async (url: URL | string) =>
      String(url).endsWith('/gallery-shell') ? new Response(SHELL) : new Response('<html>Not found</html>', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const page = await GET(new Request(`http://localhost:3210/g/${g.slug}`) as never);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`"slug":"${g.slug}"`);
    expect(page.headers.get('set-cookie')).toMatch(/^mv=.*; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('http://localhost:3210/gallery-shell');

    const head = await HEAD(new Request(`http://localhost:3210/g/${g.slug}`, { method: 'HEAD' }) as never);
    expect(head.status).toBe(200);

    const data = await dataGET(new Request(`http://localhost:3210/g/${g.slug}/data?set=${g.setId}`) as never);
    expect(await data.json()).toEqual({ data: { setId: g.setId, photos: [], next: null } });

    const missing = await GET(new Request('http://localhost:3210/g/no-such-gallery') as never);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('<html>Not found</html>');
  });
});
