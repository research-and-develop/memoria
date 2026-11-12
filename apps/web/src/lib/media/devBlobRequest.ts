import { forbiddenError, invalidParamsError, jsonError, notFoundError } from '@repo/api/responses';
import { logger } from '@repo/logger';
import { verifyBlobToken, type BlobTokenPayload } from '@repo/platform/blobToken';
import { isMediaType, MAX_DEV_UPLOAD_BYTES, type MediaType } from '@repo/platform/media';
import type { Config } from '@repo/platform/ports';

import { isSameOrigin } from '@/lib/security/request';

/**
 * The checks of the development-only blob routes (`/api/blobs/upload`, `/api/blobs/read`), in the
 * order they must run. No platform access: the route passes its config and the time (Unix seconds),
 * so the tests drive every branch.
 *
 * 1. 404 unless `NEXTJS_ENV=development`: the routes do not exist in production.
 * 2. The token (signed by `blobUrls` in server code): bad, expired or for the other operation → 403,
 *    never a 404, so a bad token says nothing about which keys exist. Logged without the token.
 * 3. Upload only: same-origin (a missing `Origin` with no `Sec-Fetch-Site` fails).
 * 4. Upload only: the Content-Type the token names, a Content-Length equal to the token's size, and
 *    that size within MAX_DEV_UPLOAD_BYTES (the body is buffered in memory) — before the body is read.
 *
 * These routes are the exception to "public writes verify Turnstile and the rate limit": the gate is
 * whoever mints the token (an admin API, or a public one behind Turnstile and a rate limit).
 */

export type BlobCheck<T> = { ok: true; value: T } | { ok: false; response: Response };

export type DevUpload = { key: string; contentType: MediaType; size: number };

function tokenInvalid(op: 'put' | 'get'): BlobCheck<never> {
  logger.warn({ event: 'blob_token_invalid', op });
  return {
    ok: false,
    response: jsonError(403, { error: 'Invalid or expired link', errorCode: 'BLOB_TOKEN_INVALID' }),
  };
}

async function token(req: Request, config: Config, now: number, op: 'put' | 'get'): Promise<BlobCheck<BlobTokenPayload>> {
  if (!config.isDevelopment) return { ok: false, response: notFoundError() };
  const raw = new URL(req.url).searchParams.get('t');
  const payload = await verifyBlobToken(raw, config.media.devSigningSecret, now);
  if (!payload || payload.op !== op) return tokenInvalid(op);
  return { ok: true, value: payload };
}

/** The media type of a Content-Type header, lower-cased, without parameters. */
function mediaTypeOf(header: string | null): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

export async function checkUpload(req: Request, config: Config, now: number): Promise<BlobCheck<DevUpload>> {
  const checked = await token(req, config, now, 'put');
  if (!checked.ok) return checked;
  const { key, ct, size } = checked.value;
  if (!isSameOrigin(req)) return { ok: false, response: forbiddenError({ reason: 'cross_origin' }) };

  if (!isMediaType(ct) || typeof size !== 'number') return tokenInvalid('put');
  if (mediaTypeOf(req.headers.get('content-type')) !== ct) {
    return { ok: false, response: invalidParamsError('Content-Type must be the type the upload link was made for', 'content-type') };
  }
  const length = req.headers.get('content-length');
  if (length === null || !/^\d+$/.test(length) || Number(length) !== size) {
    return { ok: false, response: invalidParamsError('Content-Length must be the size the upload link was made for', 'content-length') };
  }
  if (size > MAX_DEV_UPLOAD_BYTES) {
    return {
      ok: false,
      response: jsonError(413, {
        error: 'Payload too large',
        errorCode: 'PAYLOAD_TOO_LARGE',
        details: { message: 'The file is too large for the development upload route.', maxBytes: MAX_DEV_UPLOAD_BYTES },
      }),
    };
  }
  return { ok: true, value: { key, contentType: ct, size } };
}

export async function checkRead(req: Request, config: Config, now: number): Promise<BlobCheck<BlobTokenPayload>> {
  return token(req, config, now, 'get');
}
