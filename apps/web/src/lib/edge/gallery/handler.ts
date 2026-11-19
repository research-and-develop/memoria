import { logger } from '@repo/logger';
import { isUuid } from '@repo/core/validation';

import { galleryBySlugStatement, toPublicGalleryRow, type PublicGalleryDbRow, type PublicGalleryRow } from '../../db/queries/galleries/public';
import { publicSetsStatement, type PublicSetRow } from '../../db/queries/photo_sets/public';
import { publicPhotosStatement, type PublicPhotoRow } from '../../db/queries/photos/public';
import { studioSettingStatement, toSiteSettingRow, type SiteSettingDbRow } from '../../db/queries/site_settings/public';
import { displayKey } from '../../galleries/keys';
import { decodeCursor } from '../../galleries/sortKey';
import { isSecureRequest, readCookie } from '../../security/request';
import type { GalleryRoute } from '../routes';
import {
  VISITOR_COOKIE,
  VISITOR_TTL_SECONDS,
  accessCookieName,
  mintVisitorCookie,
  setCookieHeader,
  verifyAccessCookie,
  verifyPreviewToken,
  verifyVisitorCookie,
} from './access';
import type { EdgeGalleryDeps } from './deps';
import { galleryHeaders } from './headers';
import { injectGallery } from './inject';
import { galleryErrorPage, galleryPageHtml } from './pages';
import { galleryGateView, galleryPageView, viewPage, viewSets, viewStudio, type GalleryView, type ViewPage, type ViewSet, type ViewStudio } from './view';

/**
 * `/g/<slug>` and `/g/<slug>/data` (plan p06 D6.1, D6.5, D6.8, D6.12): one handler for `worker.ts` and
 * the development route handlers. Per request: ONE D1 batch (the gallery by slug + the studio row),
 * the access decision (fresh every time), then the sets and photo page from `deps.cache` or D1.
 * A view writes nothing to D1. Logs never carry a slug, a gallery id or a query string.
 *
 * Access: a deleted or unknown gallery → 404; a draft → 404 unless `?preview=` holds a valid preview
 * token (it opens a password draft too); a published link gallery → open; a published password gallery
 * → open with a valid `mg_` cookie for its current `password_version`, else the gate (the page) or 401
 * (`/data`). Password galleries and previews need the derived keys: without them → 503
 * (`gallery_key_missing`); link galleries still open (without the visitor cookie).
 */
const CACHE_ORIGIN = 'https://cache.internal';
const CACHE_TTL_SECONDS = 86_400;

type Access = 'open' | 'gate' | 'not-found' | 'no-key';
type FirstView = { sets: ViewSet[]; page: ViewPage | null };

/** `…/g/<id>/<content_version>/first/start` for the first view, `…/<setId>/<cursor|start>` for a page (D6.8). */
export function galleryCacheKey(gallery: Pick<PublicGalleryRow, 'id' | 'content_version'>, setId: string | 'first', cursor: string | null): string {
  return `${CACHE_ORIGIN}/g/${gallery.id}/${gallery.content_version}/${setId}/${cursor ?? 'start'}`;
}

class Unavailable extends Error {}

async function decideAccess(request: Request, gallery: PublicGalleryRow, deps: EdgeGalleryDeps): Promise<Access> {
  const keys = deps.config.keys;
  const now = deps.now();
  if (gallery.status === 'draft') {
    if (!keys) return 'no-key';
    const preview = new URL(request.url).searchParams.get('preview');
    return (await verifyPreviewToken(keys.preview, preview, { galleryId: gallery.id, now })) ? 'open' : 'not-found';
  }
  if (gallery.access === 'link') return 'open';
  if (!keys) return 'no-key';
  const cookie = readCookie(request.headers, accessCookieName(gallery.id));
  return (await verifyAccessCookie(keys.access, cookie, { galleryId: gallery.id, passwordVersion: gallery.password_version, now })) ? 'open' : 'gate';
}

async function cachedJson<T>(deps: EdgeGalleryDeps, key: string): Promise<T | null> {
  try {
    const hit = await deps.cache.match(key);
    return hit ? ((await hit.json()) as T) : null;
  } catch {
    return null;
  }
}

/** A separate INTERNAL response for the cache (public, no cookie), never the outgoing one (D6.8). */
function storeJson(deps: EdgeGalleryDeps, key: string, value: unknown): void {
  const entry = new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
  });
  deps.waitUntil(deps.cache.put(key, entry).catch(() => logger.warn({ event: 'gallery_cache_put_failed' })));
}

async function firstView(gallery: PublicGalleryRow, deps: EdgeGalleryDeps): Promise<{ value: FirstView; hit: boolean }> {
  const key = galleryCacheKey(gallery, 'first', null);
  const cached = await cachedJson<FirstView>(deps, key);
  if (cached) return { value: cached, hit: true };
  const sets = await deps.db.all<PublicSetRow>(publicSetsStatement(gallery.id));
  const first = sets[0];
  const page = first ? viewPage(first.id, await deps.db.all<PublicPhotoRow>(publicPhotosStatement(gallery.id, first.id, ''))) : null;
  const value: FirstView = { sets: viewSets(sets), page };
  storeJson(deps, key, value);
  return { value, hit: false };
}

/** A further page, or null when the set is not this gallery's (or the cursor is malformed) → 404. */
async function dataPage(gallery: PublicGalleryRow, url: URL, deps: EdgeGalleryDeps): Promise<{ value: ViewPage; hit: boolean } | null> {
  const setId = url.searchParams.get('set');
  const cursor = url.searchParams.get('cursor');
  if (!isUuid(setId)) return null;
  const after = cursor === null ? '' : decodeCursor(cursor);
  if (after === null) return null;
  const key = galleryCacheKey(gallery, setId, cursor);
  const cached = await cachedJson<ViewPage>(deps, key);
  if (cached) return { value: cached, hit: true };
  const rows = await deps.db.all<PublicPhotoRow>(publicPhotosStatement(gallery.id, setId, after));
  // Nothing: an empty set of this gallery (200), or a set of another one (404). The join already
  // refused the foreign set's photos; this rare second read only tells the two apart.
  if (rows.length === 0) {
    const sets = await deps.db.all<PublicSetRow>(publicSetsStatement(gallery.id));
    if (!sets.some((s) => s.id === setId)) return null;
  }
  const value = viewPage(setId, rows);
  storeJson(deps, key, value);
  return { value, hit: false };
}

function ogImage(gallery: PublicGalleryRow, view: GalleryView, mediaBaseUrl: string | null): string | null {
  if (view.kind !== 'gallery' || gallery.access !== 'link' || !mediaBaseUrl) return null;
  const cover = view.gallery.cover;
  return cover ? `${mediaBaseUrl}/${displayKey(gallery.id, cover.id, cover.rev, cover.ext)}` : null;
}

/** The `mv` cookie to set: none when a valid one came in, or when there are no keys. */
async function visitorCookie(request: Request, deps: EdgeGalleryDeps): Promise<string | null> {
  const keys = deps.config.keys;
  if (!keys) return null;
  if (await verifyVisitorCookie(keys.visitor, readCookie(request.headers, VISITOR_COOKIE))) return null;
  const secure = isSecureRequest(request.headers, request.url);
  return setCookieHeader(VISITOR_COOKIE, await mintVisitorCookie(keys.visitor), { maxAge: VISITOR_TTL_SECONDS, secure });
}

function jsonError(status: number, error: string, errorCode: string, deps: EdgeGalleryDeps, head: boolean): Response {
  const headers = galleryHeaders({ mediaBaseUrl: deps.config.mediaBaseUrl, kind: 'data' });
  headers.set('Cache-Control', 'private, no-store');
  return new Response(head ? null : JSON.stringify({ error, errorCode }), { status, headers });
}

function failure(route: GalleryRoute, kind: 'not-found' | 'unavailable', deps: EdgeGalleryDeps, head: boolean): Promise<Response> | Response {
  if (route.kind === 'data') {
    return kind === 'not-found'
      ? jsonError(404, 'This gallery or page does not exist.', 'NOT_FOUND', deps, head)
      : jsonError(503, 'The gallery is not available right now.', 'GALLERY_UNAVAILABLE', deps, head);
  }
  return galleryErrorPage(deps.assets, kind === 'not-found' ? 'notFound' : 'unavailable', { mediaBaseUrl: deps.config.mediaBaseUrl, head });
}

async function readGallery(route: GalleryRoute, deps: EdgeGalleryDeps): Promise<{ gallery: PublicGalleryRow | null; studio: ViewStudio }> {
  try {
    const [galleryResult, studioResult] = await deps.db.batch<Record<string, unknown>>([galleryBySlugStatement(route.slug), studioSettingStatement()]);
    const galleryRow = galleryResult?.rows[0] as PublicGalleryDbRow | undefined;
    const studioRow = studioResult?.rows[0] as SiteSettingDbRow | undefined;
    return {
      gallery: galleryRow ? toPublicGalleryRow(galleryRow) : null,
      studio: viewStudio(studioRow ? toSiteSettingRow(studioRow).value : null, deps.config.appName),
    };
  } catch {
    throw new Unavailable();
  }
}

export async function handleGalleryRequest(request: Request, route: GalleryRoute, deps: EdgeGalleryDeps): Promise<Response> {
  const head = request.method === 'HEAD';
  try {
    const { gallery, studio } = await readGallery(route, deps);
    if (!gallery) return await failure(route, 'not-found', deps, head);
    const access = await decideAccess(request, gallery, deps);
    if (access === 'not-found') return await failure(route, 'not-found', deps, head);
    if (access === 'no-key') {
      logger.error({ event: 'gallery_key_missing' });
      return await failure(route, 'unavailable', deps, head);
    }
    const cookie = await visitorCookie(request, deps);

    if (route.kind === 'data') {
      if (access === 'gate') return jsonError(401, 'Enter the gallery password.', 'GALLERY_LOCKED', deps, head);
      const page = await dataPage(gallery, new URL(request.url), deps);
      if (!page) return await failure(route, 'not-found', deps, head);
      const headers = galleryHeaders({ mediaBaseUrl: deps.config.mediaBaseUrl, kind: 'data' });
      headers.set('X-Gallery-Cache', page.hit ? 'hit' : 'miss');
      if (cookie) headers.append('Set-Cookie', cookie);
      return new Response(head ? null : JSON.stringify({ data: page.value }), { status: 200, headers });
    }

    const shell = await galleryPageHtml(deps.assets, 'shell');
    if (shell === null) return await failure(route, 'unavailable', deps, head);
    let view: GalleryView;
    let hit: boolean | null = null;
    if (access === 'gate') {
      view = galleryGateView({ gallery, studio, turnstileSiteKey: deps.config.turnstileSiteKey });
    } else {
      const first = await firstView(gallery, deps);
      hit = first.hit;
      view = galleryPageView({ gallery, studio, mediaBaseUrl: deps.config.mediaBaseUrl, ...first.value });
    }
    let html: string;
    try {
      html = injectGallery(shell, view, { ogImage: ogImage(gallery, view, deps.config.mediaBaseUrl) });
    } catch {
      logger.error({ event: 'gallery_shell_missing', page: 'shell', reason: 'marker' });
      return await failure(route, 'unavailable', deps, head);
    }
    const headers = galleryHeaders({ mediaBaseUrl: deps.config.mediaBaseUrl, kind: 'page' });
    if (hit !== null) headers.set('X-Gallery-Cache', hit ? 'hit' : 'miss');
    if (cookie) headers.append('Set-Cookie', cookie);
    return new Response(head ? null : html, { status: 200, headers });
  } catch (error) {
    // A D1 error (or anything unexpected): never the slug, the id or the query string in the log.
    logger.error({ event: 'gallery_unavailable', kind: error instanceof Unavailable ? 'd1' : 'other' });
    return failure(route, 'unavailable', deps, head);
  }
}
