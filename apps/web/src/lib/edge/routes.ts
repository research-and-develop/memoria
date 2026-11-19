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
import { galleryErrorPage, galleryPageHtml, type AssetFetcher } from './gallery/pages';
import { galleryHeaders } from './gallery/headers';

export const HEALTH_PATH = '/healthz';

/** Same value as the Next responses get (src/lib/security/headers.mjs): nothing is indexed. */
export const ROBOTS_TAG = 'noindex, nofollow';

export type EdgeEnv = { CF_VERSION_METADATA?: { id: string }; MEDIA_PUBLIC_BASE_URL?: string };

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

export type EdgeDeps = { env: EdgeEnv; assets: AssetFetcher };

export async function routeEdge(request: Request, deps: EdgeDeps, next: () => Promise<Response>): Promise<Response> {
  const early = edgeResponse(request, deps.env);
  if (early) return early;
  const { pathname } = new URL(request.url);
  if (!inGalleryPrefix(pathname)) return next();

  const mediaBaseUrl = deps.env.MEDIA_PUBLIC_BASE_URL || null;
  const head = request.method === 'HEAD';
  const route = galleryRoute(pathname, request.method);
  // The gallery's data (and `/data`) arrive with the handler (plan p06 T6.3); until then every gallery
  // page is the bare shell.
  if (!route || route.kind === 'data') return galleryErrorPage(deps.assets, 'notFound', { mediaBaseUrl, head });
  const shell = await galleryPageHtml(deps.assets, 'shell');
  if (shell === null) return galleryErrorPage(deps.assets, 'unavailable', { mediaBaseUrl, head });
  return new Response(head ? null : shell, { status: 200, headers: galleryHeaders({ mediaBaseUrl, kind: 'page' }) });
}
