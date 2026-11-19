/**
 * Paths the Worker entry answers before Next.js loads (apps/web/worker.ts).
 *
 * - `edgeResponse`: pure and dependency-free, the health probe (no D1).
 * - `routeEdge`: the whole decision, with the Next path as a callback: the health probe, the client
 *   galleries under `/g/` (plan p06 D6.1, D6.5), else `next()` — which `worker.ts` implements by
 *   importing OpenNext lazily, so a gallery request never loads Next.
 *
 * Structural types only (no Cloudflare type: guard `platform-boundary`); everything reachable from here
 * must stay out of `server-only` and `@repo/db/client` (it runs outside Next's bundle).
 */
import type { EdgeGalleryDeps } from './gallery/deps';
import { handleGalleryRequest } from './gallery/handler';
import { galleryErrorPage } from './gallery/pages';

export const HEALTH_PATH = '/healthz';

/** Same value as the Next responses get (src/lib/security/headers.mjs): nothing is indexed. */
export const ROBOTS_TAG = 'noindex, nofollow';

export type EdgeEnv = { CF_VERSION_METADATA?: { id: string } };

export function edgeResponse(request: Request, env: EdgeEnv): Response | null {
  const { pathname } = new URL(request.url);
  if (pathname === HEALTH_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
    // Liveness only: no D1 read, so an uptime check costs none of the daily allowance.
    const body = request.method === 'HEAD' ? null : JSON.stringify({ data: { status: 'ok', version: env.CF_VERSION_METADATA?.id ?? null } });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': ROBOTS_TAG },
    });
  }
  return null;
}

/** Phase 5's slug shape (D5.3, `ck_galleries_slug`): `[a-z0-9-]`, 3–60, no hyphen at either end. */
const GALLERY_PATH = /^\/g\/([a-z0-9][a-z0-9-]{1,58}[a-z0-9])(\/data)?$/;

export type GalleryRoute = { slug: string; kind: 'page' | 'data' };

/**
 * `/g/<slug>` or `/g/<slug>/data`, by GET or HEAD — exactly: a lower-case slug, no trailing slash
 * (D6.5). Anything else under `/g/` is not a gallery route (→ the 404 page, never Next).
 */
export function galleryRoute(pathname: string, method: string): GalleryRoute | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const match = GALLERY_PATH.exec(pathname);
  if (!match?.[1]) return null;
  return { slug: match[1], kind: match[2] ? 'data' : 'page' };
}

export function isGalleryPath(pathname: string, method: string): boolean {
  return galleryRoute(pathname, method) !== null;
}

/**
 * Everything under `/g/` (any case: `/G/x` too) belongs to the gallery code: `worker.ts` answers it,
 * Next never sees it.
 */
export function inGalleryPrefix(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === '/g' || lower.startsWith('/g/');
}

/**
 * `gallery()` builds the gallery deps on demand (the config derives keys): only a request under `/g/`
 * pays for it.
 */
export type EdgeDeps = { env: EdgeEnv; gallery: () => Promise<EdgeGalleryDeps> };

export async function routeEdge(request: Request, deps: EdgeDeps, next: () => Promise<Response>): Promise<Response> {
  const early = edgeResponse(request, deps.env);
  if (early) return early;
  const { pathname } = new URL(request.url);
  if (!inGalleryPrefix(pathname)) return next();

  const gallery = await deps.gallery();
  const route = galleryRoute(pathname, request.method);
  if (!route) return galleryErrorPage(gallery.assets, 'notFound', { mediaBaseUrl: gallery.config.mediaBaseUrl, head: request.method === 'HEAD' });
  return handleGalleryRequest(request, route, gallery);
}
