import { securityHeaders } from '../../security/headers.mjs';

/**
 * The headers of every response `worker.ts` gives for a gallery (plan p06 D6.13): outside Next none of
 * next.config.mjs's headers apply, so they are set here. The gallery CSP profile (Phase 4 D4.15: the
 * studio policy minus the beacon and the S3 endpoint, Turnstile and `'unsafe-inline'` scripts kept,
 * the media domain in `img-src`), plus:
 * - `Referrer-Policy: no-referrer` (the slug of a link gallery is its secret);
 * - `Cache-Control`: `private, no-store` for pages, `private, max-age=60` for `/data`.
 * `X-Robots-Tag: noindex, nofollow` comes with the security headers.
 * Pure: `worker.ts` never runs the React dev build, so `dev` is always false.
 */
export type GalleryResponseKind = 'page' | 'data';

export function galleryHeaders(opts: { mediaBaseUrl: string | null; kind: GalleryResponseKind }): Headers {
  const headers = new Headers();
  for (const { key, value } of securityHeaders({ dev: false, profile: 'gallery', media: { publicBaseUrl: opts.mediaBaseUrl } })) {
    headers.set(key, value);
  }
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cache-Control', opts.kind === 'page' ? 'private, no-store' : 'private, max-age=60');
  headers.set('Content-Type', opts.kind === 'page' ? 'text/html; charset=utf-8' : 'application/json');
  return headers;
}
