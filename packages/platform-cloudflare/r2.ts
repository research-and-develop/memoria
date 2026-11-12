import type { BlobMeta, BlobPutOptions, BlobStore } from '@repo/platform/ports';

/**
 * The BlobStore port on an R2 binding (the Worker's `env.MEDIA`, or a miniflare proxy of it in
 * tests and `next dev`). Passes the contract suite (@repo/platform/contract/blobStore) in workerd.
 *
 * Checked through the proxy before this was written (Phase 1, T1.8): `put` of bytes, a streamed
 * `get().body`, the `onlyIf: { etagDoesNotMatch: '*' }` wildcard and `uploaded` as a `Date` all
 * work, so the adapter has no proxy-only fallbacks.
 */

/** R2's `delete` takes at most 1000 keys per call; the port has no limit. */
const DELETE_CHUNK = 1000;
const MAX_LIST = 1000;

function iso(uploaded: Date | string): string {
  return (uploaded instanceof Date ? uploaded : new Date(uploaded)).toISOString();
}

function metaOf(obj: R2Object): BlobMeta {
  return {
    key: obj.key,
    size: obj.size,
    contentType: obj.httpMetadata?.contentType ?? null,
    etag: obj.httpEtag,
    uploadedAt: iso(obj.uploaded),
  };
}

export function r2BlobStore(bucket: R2Bucket): BlobStore {
  return {
    async put(key: string, bytes: ArrayBuffer | Uint8Array, opts: BlobPutOptions) {
      const obj = await bucket.put(key, bytes, {
        httpMetadata: { contentType: opts.contentType, ...(opts.cacheControl ? { cacheControl: opts.cacheControl } : {}) },
        // R2 answers null when the condition fails: here, when the key already exists.
        ...(opts.ifAbsent ? { onlyIf: { etagDoesNotMatch: '*' } } : {}),
      });
      return obj ? metaOf(obj) : false;
    },

    async get(key: string) {
      const obj = await bucket.get(key);
      return obj ? { ...metaOf(obj), body: obj.body as ReadableStream<Uint8Array> } : null;
    },

    async head(key: string) {
      const obj = await bucket.head(key);
      return obj ? metaOf(obj) : null;
    },

    async delete(keys: readonly string[]) {
      for (let i = 0; i < keys.length; i += DELETE_CHUNK) await bucket.delete(keys.slice(i, i + DELETE_CHUNK));
    },

    async list({ prefix, cursor = null, limit = MAX_LIST }) {
      const page = await bucket.list({
        prefix,
        limit: Math.min(Math.max(1, limit), MAX_LIST),
        include: ['httpMetadata'],
        ...(cursor ? { cursor } : {}),
      });
      return { blobs: page.objects.map(metaOf), cursor: page.truncated ? page.cursor : null };
    },
  };
}
