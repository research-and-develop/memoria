import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@repo/platform/ports';

import { NO_CACHE, type EdgeGalleryDeps } from './gallery/deps';
import { GALLERY_PAGES } from './gallery/markers.mjs';
import { HEALTH_PATH, ROBOTS_TAG, edgeResponse, galleryRoute, routeEdge, type EdgeDeps } from './routes';

const env = { CF_VERSION_METADATA: { id: 'v-123' } };

describe('edgeResponse', () => {
  it('answers the health probe with the running version, uncached', async () => {
    const res = edgeResponse(new Request(`https://x.test${HEALTH_PATH}`), env);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('cache-control')).toBe('no-store');
    expect(res?.headers.get('x-robots-tag')).toBe(ROBOTS_TAG);
    expect(await res?.json()).toEqual({ data: { status: 'ok', version: 'v-123' } });
  });

  it('answers HEAD without a body', async () => {
    const res = edgeResponse(new Request(`https://x.test${HEALTH_PATH}`, { method: 'HEAD' }), env);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('');
  });

  it.each([
    ['another path', 'https://x.test/', 'GET'],
    ['a POST to the probe', `https://x.test${HEALTH_PATH}`, 'POST'],
    ['a sub-path', `https://x.test${HEALTH_PATH}/x`, 'GET'],
  ])('hands %s to Next', (_label, url, method) => {
    expect(edgeResponse(new Request(url, { method }), env)).toBeNull();
  });
});

describe('galleryRoute', () => {
  it.each([
    ['/g/maria-jonas-k7x2qpm4rt', 'GET', { slug: 'maria-jonas-k7x2qpm4rt', kind: 'page' }],
    ['/g/abc', 'HEAD', { slug: 'abc', kind: 'page' }],
    ['/g/abc/data', 'GET', { slug: 'abc', kind: 'data' }],
    [`/g/${'a'.repeat(60)}`, 'GET', { slug: 'a'.repeat(60), kind: 'page' }],
  ])('%s by %s is a gallery route', (path, method, expected) => {
    expect(galleryRoute(path, method)).toEqual(expected);
  });

  it.each([
    ['upper case', '/G/abc', 'GET'],
    ['an upper-case slug', '/g/Abc', 'GET'],
    ['a trailing slash', '/g/abc/', 'GET'],
    ['another sub-path', '/g/abc/other', 'GET'],
    ['a POST', '/g/abc', 'POST'],
    ['a slug too short', '/g/ab', 'GET'],
    ['a slug too long', `/g/${'a'.repeat(61)}`, 'GET'],
    ['a leading hyphen', '/g/-abc', 'GET'],
    ['a trailing hyphen', '/g/abc-', 'GET'],
    ['an encoded character', '/g/ab%2Fc', 'GET'],
    ['the bare prefix', '/g', 'GET'],
  ])('refuses %s', (_label, path, method) => {
    expect(galleryRoute(path, method)).toBeNull();
  });
});

describe('routeEdge', () => {
  const NOT_FOUND = '<html><title>Page not found</title></html>';

  /** Gallery deps whose D1 knows no gallery: a routed request reaches the handler (one batch) and gets the 404 page. */
  function deps(): EdgeDeps & { fetched: string[]; batches: () => number } {
    const fetched: string[] = [];
    let batches = 0;
    const db = {
      batch: async () => {
        batches += 1;
        return [
          { rows: [], changes: 0 },
          { rows: [], changes: 0 },
        ];
      },
    } as unknown as Db;
    const gallery: EdgeGalleryDeps = {
      db,
      assets: async (path) => {
        fetched.push(path);
        return path === GALLERY_PAGES.notFound ? new Response(NOT_FOUND, { status: 200 }) : new Response('missing', { status: 404 });
      },
      cache: NO_CACHE,
      config: { mediaBaseUrl: 'https://media.example.test', keys: null, turnstileSiteKey: '', appName: 'Studio', isDevelopment: false },
      now: () => new Date(),
      waitUntil: () => {},
    };
    return { env, fetched, batches: () => batches, gallery: async () => gallery };
  }

  const throwingNext = () => {
    throw new Error('Next must not be called for this path');
  };

  afterEach(() => vi.restoreAllMocks());

  it('answers /healthz without calling Next', async () => {
    const res = await routeEdge(new Request(`https://x.test${HEALTH_PATH}`), deps(), throwingNext);
    expect(res.status).toBe(200);
  });

  it.each(['/g/maria-jonas-k7x2qpm4rt', '/g/abc/data', '/g/abc?cpu_probe=1'])('%s reaches the gallery handler, not Next', async (path) => {
    const d = deps();
    const res = await routeEdge(new Request(`https://x.test${path}`), d, throwingNext);
    expect(d.batches()).toBe(1);
    expect(res.status).toBe(404);
  });

  it('sets the gallery headers on the 404 page (D6.13)', async () => {
    const res = await routeEdge(new Request('https://x.test/g/abc'), deps(), throwingNext);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe(ROBOTS_TAG);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/img-src [^;]*https:\/\/media\.example\.test/);
    expect(csp).toMatch(/script-src [^;]*'unsafe-inline'[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src https:\/\/challenges\.cloudflare\.com/);
    expect(csp).not.toContain('cloudflareinsights');
  });

  it.each([
    ['/G/abc', 'GET'],
    ['/g/abc/', 'GET'],
    ['/g/abc/other', 'GET'],
    ['/g/abc', 'POST'],
    ['/g/', 'GET'],
    ['/g', 'GET'],
  ])('%s by %s → the 404 page without a D1 read, never Next', async (path, method) => {
    const d = deps();
    const res = await routeEdge(new Request(`https://x.test${path}`, { method }), d, throwingNext);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND);
    expect(d.batches()).toBe(0);
  });

  it.each(['/', '/admin', '/api/admin/login', '/api/g/abc/access', '/gallery-shell', '/galleries', '/_next/static/x.js'])(
    'hands %s to Next',
    async (path) => {
      const next = vi.fn(async () => new Response('next'));
      const d = deps();
      const res = await routeEdge(new Request(`https://x.test${path}`), d, next);
      expect(next).toHaveBeenCalledOnce();
      expect(await res.text()).toBe('next');
      expect(d.fetched).toEqual([]);
    },
  );
});
