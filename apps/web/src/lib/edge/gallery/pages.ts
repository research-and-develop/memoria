import { logger } from '@repo/logger';

import { galleryHeaders } from './headers';
import { GALLERY_PAGES } from './markers.mjs';

/** Fetches a path from the Worker's static assets (`env.ASSETS.fetch` in production). Structural: no Cloudflare type. */
export type AssetFetcher = (path: string) => Promise<Response>;

export type GalleryPage = keyof typeof GALLERY_PAGES;

/**
 * The HTML of one of the three pages `build:app` copies into the assets (plan p06 D6.3), or null —
 * logged `gallery_shell_missing` — when the assets do not answer 200 (a build without the step, or a
 * broken deploy).
 */
export async function galleryPageHtml(assets: AssetFetcher, page: GalleryPage): Promise<string | null> {
  const res = await assets(GALLERY_PAGES[page]);
  if (res.status !== 200) {
    await res.body?.cancel();
    logger.error({ event: 'gallery_shell_missing', page, status: res.status });
    return null;
  }
  return res.text();
}

/**
 * The 404 or 503 page as a response (`worker.ts` headers, D6.13). If the page itself is missing, a
 * bare 503 — never a fall-through to Next.
 */
export async function galleryErrorPage(
  assets: AssetFetcher,
  page: 'notFound' | 'unavailable',
  opts: { mediaBaseUrl: string | null; head: boolean },
): Promise<Response> {
  const html = await galleryPageHtml(assets, page);
  const headers = galleryHeaders({ mediaBaseUrl: opts.mediaBaseUrl, kind: 'page' });
  if (html === null) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(opts.head ? null : 'The gallery is not available right now.', { status: 503, headers });
  }
  return new Response(opts.head ? null : html, { status: page === 'notFound' ? 404 : 503, headers });
}
