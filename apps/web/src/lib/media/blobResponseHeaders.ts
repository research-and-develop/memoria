import { contentDisposition, isMediaType } from '@repo/platform/media';
import type { BlobMeta } from '@repo/platform/ports';

/**
 * Headers of the development-only blob routes. Pure.
 *
 * Every response (errors included) is inert in a browser: no sniffing, a sandboxing CSP that runs
 * nothing, no Referer carrying the token onwards. A stored file is served with its own type only if
 * that type is an allowed image; anything else is an `application/octet-stream` attachment.
 */
export const BLOB_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Referrer-Policy': 'no-referrer',
};

export function withBlobSecurityHeaders<R extends Response>(res: R): R {
  for (const [name, value] of Object.entries(BLOB_SECURITY_HEADERS)) res.headers.set(name, value);
  return res;
}

/** The last segment of a key (the default download name). */
function baseName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

/**
 * Headers for serving `meta`, read through a token valid until `exp` (Unix seconds) and carrying
 * the download name `dn` when there is one. Also right for a 304 (minus the body headers).
 */
export function blobReadHeaders(meta: BlobMeta, token: { exp: number; dn?: string }, now: number): Headers {
  const headers = new Headers(BLOB_SECURITY_HEADERS);
  const servable = isMediaType(meta.contentType);
  headers.set('Content-Type', servable ? meta.contentType! : 'application/octet-stream');
  headers.set('Content-Length', String(meta.size));
  headers.set('ETag', meta.etag);
  headers.set('Cache-Control', `private, max-age=${Math.max(0, token.exp - now)}`);
  if (token.dn !== undefined) headers.set('Content-Disposition', contentDisposition(token.dn));
  else if (!servable) headers.set('Content-Disposition', contentDisposition(baseName(meta.key)));
  return headers;
}
