import type { BlobMeta, BlobObject, BlobPutOptions, BlobStore } from '../ports';

/**
 * A BlobStore in memory: the test platform's default, and a reference for the contract suite
 * (contract/blobStore.ts), which R2 must pass too. Not for production.
 */

type Entry = { bytes: Uint8Array<ArrayBuffer>; meta: BlobMeta };

/** A private copy (the caller may reuse its buffer). */
function copy(bytes: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

async function etagOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `"${Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

function bodyOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

export function memoryBlobStore(): BlobStore {
  const entries = new Map<string, Entry>();

  return {
    async put(key: string, bytes: ArrayBuffer | Uint8Array, opts: BlobPutOptions): Promise<BlobMeta | false> {
      if (opts.ifAbsent && entries.has(key)) return false;
      const data = copy(bytes);
      const meta: BlobMeta = {
        key,
        size: data.byteLength,
        contentType: opts.contentType,
        etag: await etagOf(data),
        uploadedAt: new Date().toISOString(),
      };
      entries.set(key, { bytes: data, meta });
      return { ...meta };
    },

    async get(key: string): Promise<BlobObject | null> {
      const entry = entries.get(key);
      return entry ? { ...entry.meta, body: bodyOf(entry.bytes) } : null;
    },

    async head(key: string): Promise<BlobMeta | null> {
      const entry = entries.get(key);
      return entry ? { ...entry.meta } : null;
    },

    async delete(keys: readonly string[]): Promise<void> {
      for (const key of keys) entries.delete(key);
    },

    async list({ prefix, cursor = null, limit = 1000 }) {
      const size = Math.min(Math.max(1, limit), 1000);
      const keys = [...entries.keys()].filter((k) => k.startsWith(prefix) && (cursor === null || k > cursor)).sort();
      const page = keys.slice(0, size);
      const blobs = page.map((k) => ({ ...(entries.get(k) as Entry).meta }));
      return { blobs, cursor: keys.length > size ? (page[page.length - 1] ?? null) : null };
    },
  };
}
