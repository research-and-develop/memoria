import { afterEach, describe, expect, it, vi } from 'vitest';

import { GALLERY_PAGES } from './gallery/markers.mjs';
import { HEALTH_PATH, ROBOTS_TAG, edgeResponse, galleryRoute, routeEdge, type EdgeDeps } from './routes';

const env = { CF_VERSION_METADATA: { id: 'v-123' }, MEDIA_PUBLIC_BASE_URL: 'https://media.example.test' };

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
  const SHELL = '<!DOCTYPE html><html lang="en"><body>shell</body></html>';
  const NOT_FOUND = '<html><title>Page not found</title></html>';
  const UNAVAILABLE = '<html><title>Not available right now</title></html>';

  function deps(pages: Partial<Record<string, string>> = {}): EdgeDeps & { fetched: string[] } {
    const files: Record<string, string | undefined> = {
      [GALLERY_PAGES.shell]: SHELL,
      [GALLERY_PAGES.notFound]: NOT_FOUND,
      [GALLERY_PAGES.unavailable]: UNAVAILABLE,
      ...pages,
    };
    const fetched: string[] = [];
    return {
      env,
      fetched,
      assets: async (path) => {
        fetched.push(path);
        const body = files[path];
        return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
      },
    };
  }

  const throwingNext = () => {
    throw new Error('Next must not be called for this path');
  };

  afterEach(() => vi.restoreAllMocks());

  it('answers /healthz without calling Next', async () => {
    const res = await routeEdge(new Request(`https://x.test${HEALTH_PATH}`), deps(), throwingNext);
    expect(res.status).toBe(200);
  });

  it('serves a gallery page from the shell, without calling Next', async () => {
    const d = deps();
    const res = await routeEdge(new Request('https://x.test/g/maria-jonas-k7x2qpm4rt'), d, throwingNext);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
    expect(d.fetched).toEqual([GALLERY_PAGES.shell]);
  });

  it('sets the gallery headers (D6.13)', async () => {
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

  it('answers HEAD without a body', async () => {
    const res = await routeEdge(new Request('https://x.test/g/abc', { method: 'HEAD' }), deps(), throwingNext);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it.each([
    ['/G/abc', 'GET'],
    ['/g/abc/', 'GET'],
    ['/g/abc/other', 'GET'],
    ['/g/abc', 'POST'],
    ['/g/', 'GET'],
    ['/g', 'GET'],
    // The data route arrives with the handler (T6.3).
    ['/g/abc/data', 'GET'],
  ])('%s by %s → the 404 page, never Next', async (path, method) => {
    const res = await routeEdge(new Request(`https://x.test${path}`, { method }), deps(), throwingNext);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND);
    expect(res.headers.get('x-robots-tag')).toBe(ROBOTS_TAG);
  });

  it('answers the 503 page when the shell is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await routeEdge(new Request('https://x.test/g/abc'), deps({ [GALLERY_PAGES.shell]: undefined }), throwingNext);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(UNAVAILABLE);
    expect(error.mock.calls.flat().join(' ')).not.toContain('abc');
  });

  it('answers a bare 503 when the error page is missing too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await routeEdge(
      new Request('https://x.test/g/abc'),
      deps({ [GALLERY_PAGES.shell]: undefined, [GALLERY_PAGES.unavailable]: undefined }),
      throwingNext,
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it.each(['/', '/admin', '/api/admin/login', '/gallery-shell', '/galleries', '/_next/static/x.js'])(
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
