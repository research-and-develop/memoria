import { AwsV4Signer } from 'aws4fetch';

import { AppError } from '@repo/core/error';

import { signBlobToken, type BlobTokenBucket } from './blobToken';
import { contentDisposition, isBlobKey, isMediaType, MAX_DEV_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from './media';
import type { BucketName, Config, S3Config } from './ports';

/**
 * URLs for stored files, neutral across platforms. Server code only (it signs); it has no
 * `server-only` import so the tsx probe script can use it.
 *
 * Mode, in order:
 * - **s3**: presigned PUT/GET on the S3 endpoint (R2's in production; MinIO or S3 under Docker).
 *   The upload's Content-Type is signed (`allHeaders`), so the browser must send exactly it.
 *   Presigned GETs are for downloads only: each is unique, so they defeat caching; gallery images use
 *   `publicUrl` or the Worker's protected path (Phase 6).
 * - **dev**: the development-only routes `/api/blobs/upload` and `/api/blobs/read` with an HMAC token
 *   (relative URLs: the site URL may be unknown).
 * - **none**: minting throws MEDIA_NOT_CONFIGURED (503). There is no production fallback.
 *
 * Bounds are checked first and violations throw INVALID_BLOB_REQUEST (a bug in the caller); nothing
 * is clamped.
 *
 * Buckets (plan p05, D5.1): `{ bucket: 'originals' }` mints for the private originals bucket (S3: its
 * name in the path; dev: the token's `b`). `publicUrl` exists for `media` only: an original is never
 * on the public domain, so asking for one throws.
 *
 * Signing keys are cached (D5.25): one aws4fetch `cache` per access key id on `globalThis`, so the
 * HMAC chain that derives the day's signing key runs once a day per isolate, not once per URL.
 */

export const MAX_UPLOAD_EXPIRY = 900;
export const MAX_S3_READ_EXPIRY = 86_400;
export const MAX_DEV_READ_EXPIRY = 3600;

export type SignedUpload = { url: string; method: 'PUT'; headers: { 'content-type': string } };
export type BlobUrlMode = 's3' | 'dev' | 'none';

export type BlobUrls = {
  mode: BlobUrlMode;
  uploadUrl(key: string, opts: { contentType: string; size: number; expiresInSeconds?: number; bucket?: BucketName }): Promise<SignedUpload>;
  readUrl(key: string, opts?: { expiresInSeconds?: number; downloadName?: string; bucket?: BucketName }): Promise<string>;
  /**
   * The public media domain URL, or null when there is none (then use `readUrl`). `media` only:
   * `{ bucket: 'originals' }` throws (a programming error, D5.1).
   */
  publicUrl(key: string, opts?: { bucket?: BucketName }): string | null;
};

export type BlobUrlOptions = {
  /** Unix seconds. */
  now?: () => number;
  /** Fixed SigV4 time (`YYYYMMDDTHHMMSSZ`), for tests. */
  signingTime?: string;
};

function invalid(message: string): AppError {
  return new AppError(message, 'INVALID_BLOB_REQUEST', { status: 400 });
}

function notConfigured(): AppError {
  return new AppError('Media storage is not configured', 'MEDIA_NOT_CONFIGURED', {
    status: 503,
    message: 'File storage is not configured yet.',
  });
}

export function blobUrlMode(config: Config): BlobUrlMode {
  if (config.media.s3) return 's3';
  if (config.isDevelopment && config.media.devSigningSecret) return 'dev';
  return 'none';
}

const SIGNER_CACHES = Symbol.for('memoria.blobUrls.signerCaches');
type CacheHolder = { [SIGNER_CACHES]?: Map<string, Map<string, ArrayBuffer>> };

/** The signing-key cache for one access key id, shared by every signer in the isolate (D5.25). */
export function signerCache(accessKeyId: string): Map<string, ArrayBuffer> {
  const holder = globalThis as CacheHolder;
  const caches = (holder[SIGNER_CACHES] ??= new Map());
  let cache = caches.get(accessKeyId);
  if (!cache) {
    cache = new Map();
    caches.set(accessKeyId, cache);
  }
  return cache;
}

const bucketNameOf = (s3: S3Config, bucket: BucketName): string => (bucket === 'originals' ? s3.originalsBucket : s3.bucket);

async function presign(s3: S3Config, bucket: BucketName, method: 'PUT' | 'GET', key: string, expires: number, opts: BlobUrlOptions, extra: {
  contentType?: string;
  disposition?: string;
}): Promise<string> {
  const url = new URL(`${s3.endpoint}/${bucketNameOf(s3, bucket)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(expires));
  if (extra.disposition) url.searchParams.set('response-content-disposition', extra.disposition);
  const signer = new AwsV4Signer({
    method,
    url: url.toString(),
    headers: extra.contentType ? { 'content-type': extra.contentType } : undefined,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    cache: signerCache(s3.accessKeyId),
    service: 's3',
    region: 'auto',
    signQuery: true,
    allHeaders: true,
    datetime: opts.signingTime,
  });
  return (await signer.sign()).url.toString();
}

const tokenBucket = (bucket: BucketName): BlobTokenBucket => (bucket === 'originals' ? 'o' : 'm');

export function blobUrls(config: Config, opts: BlobUrlOptions = {}): BlobUrls {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const mode = blobUrlMode(config);
  const { s3, devSigningSecret, publicBaseUrl } = config.media;

  return {
    mode,

    async uploadUrl(key, { contentType, size, expiresInSeconds = 600, bucket = 'media' }) {
      if (!isBlobKey(key)) throw invalid('Invalid blob key');
      if (!isMediaType(contentType)) throw invalid('Content type not allowed');
      const max = mode === 'dev' ? MAX_DEV_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
      if (!Number.isInteger(size) || size <= 0 || size > max) throw invalid('Size out of bounds');
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > MAX_UPLOAD_EXPIRY) throw invalid('Expiry out of bounds');
      const headers = { 'content-type': contentType };
      if (mode === 's3' && s3) return { url: await presign(s3, bucket, 'PUT', key, expiresInSeconds, opts, { contentType }), method: 'PUT', headers };
      if (mode === 'dev' && devSigningSecret) {
        const token = await signBlobToken(
          { v: 1, op: 'put', b: tokenBucket(bucket), key, exp: now() + expiresInSeconds, ct: contentType, size },
          devSigningSecret,
        );
        return { url: `/api/blobs/upload?t=${token}`, method: 'PUT', headers };
      }
      throw notConfigured();
    },

    async readUrl(key, { expiresInSeconds = 300, downloadName, bucket = 'media' } = {}) {
      if (!isBlobKey(key)) throw invalid('Invalid blob key');
      const max = mode === 'dev' ? MAX_DEV_READ_EXPIRY : MAX_S3_READ_EXPIRY;
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > max) throw invalid('Expiry out of bounds');
      if (mode === 's3' && s3) {
        return presign(s3, bucket, 'GET', key, expiresInSeconds, opts, { disposition: downloadName ? contentDisposition(downloadName) : undefined });
      }
      if (mode === 'dev' && devSigningSecret) {
        const token = await signBlobToken(
          { v: 1, op: 'get', b: tokenBucket(bucket), key, exp: now() + expiresInSeconds, ...(downloadName ? { dn: downloadName } : {}) },
          devSigningSecret,
        );
        return `/api/blobs/read?t=${token}`;
      }
      throw notConfigured();
    },

    publicUrl(key, { bucket = 'media' } = {}) {
      if (bucket !== 'media') throw new Error('publicUrl: the originals bucket has no public URL');
      if (!isBlobKey(key)) throw invalid('Invalid blob key');
      return publicBaseUrl ? `${publicBaseUrl}/${key}` : null;
    },
  };
}
