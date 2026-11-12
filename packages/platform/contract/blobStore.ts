import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BlobStore } from '../ports';

/**
 * The BlobStore contract: what every adapter must do, run against each (memory, R2 through the
 * workerd proxy, a Docker adapter later). Test-only: import it from a *.test.ts file
 * (guard: platform-boundary).
 *
 *   describeBlobStoreContract('memory', async () => ({ blobs: memoryBlobStore(), dispose: async () => {} }));
 *
 * Every test writes under its own prefix, so a shared store is fine.
 */
export type BlobStoreSetup = () => Promise<{ blobs: BlobStore; dispose(): Promise<void> }>;

const bytes = (text: string) => new TextEncoder().encode(text);
const read = async (body: ReadableStream<Uint8Array>) => new TextDecoder().decode(await new Response(body).arrayBuffer());

export function describeBlobStoreContract(name: string, setup: BlobStoreSetup): void {
  describe(`BlobStore contract: ${name}`, () => {
    let blobs: BlobStore;
    let dispose: () => Promise<void>;
    let run = 0;
    let p = '';

    beforeAll(async () => {
      ({ blobs, dispose } = await setup());
    });
    afterAll(() => dispose());
    beforeEach(() => {
      run += 1;
      p = `dev/contract/${Date.now().toString(36)}-${run}/`;
    });

    it('puts, reads back the bytes, type and size, and heads', async () => {
      const meta = await blobs.put(`${p}a.png`, bytes('hello'), { contentType: 'image/png' });
      expect(meta).toMatchObject({ key: `${p}a.png`, size: 5, contentType: 'image/png' });
      const object = await blobs.get(`${p}a.png`);
      expect(object).not.toBeNull();
      expect(await read(object!.body)).toBe('hello');
      expect(object).toMatchObject({ size: 5, contentType: 'image/png' });
      const head = await blobs.head(`${p}a.png`);
      expect(head).toMatchObject({ key: `${p}a.png`, size: 5, contentType: 'image/png' });
      expect(head!.etag).toMatch(/^"[^"]+"$/);
      expect(head!.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    });

    it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
      await blobs.put(`${p}b.png`, bytes('buffer').buffer as ArrayBuffer, { contentType: 'image/png' });
      expect(await read((await blobs.get(`${p}b.png`))!.body)).toBe('buffer');
    });

    it('returns null for a missing key', async () => {
      expect(await blobs.get(`${p}missing.png`)).toBeNull();
      expect(await blobs.head(`${p}missing.png`)).toBeNull();
    });

    it('overwrites by default, and changes the etag with the content', async () => {
      const first = await blobs.put(`${p}c.png`, bytes('one'), { contentType: 'image/png' });
      const second = await blobs.put(`${p}c.png`, bytes('two!'), { contentType: 'image/webp' });
      expect(await read((await blobs.get(`${p}c.png`))!.body)).toBe('two!');
      expect((await blobs.head(`${p}c.png`))!.contentType).toBe('image/webp');
      expect(first && second && first.etag !== second.etag).toBe(true);
    });

    it('keeps an existing object with ifAbsent, and writes a new one', async () => {
      expect(await blobs.put(`${p}d.png`, bytes('first'), { contentType: 'image/png', ifAbsent: true })).not.toBe(false);
      expect(await blobs.put(`${p}d.png`, bytes('second'), { contentType: 'image/png', ifAbsent: true })).toBe(false);
      expect(await read((await blobs.get(`${p}d.png`))!.body)).toBe('first');
    });

    it('deletes many keys and ignores missing ones', async () => {
      await blobs.put(`${p}e1.png`, bytes('1'), { contentType: 'image/png' });
      await blobs.put(`${p}e2.png`, bytes('2'), { contentType: 'image/png' });
      await blobs.delete([`${p}e1.png`, `${p}e2.png`, `${p}never.png`]);
      expect(await blobs.head(`${p}e1.png`)).toBeNull();
      expect(await blobs.head(`${p}e2.png`)).toBeNull();
      await blobs.delete([]);
    });

    it('lists by prefix in key order, page by page', async () => {
      for (const k of ['l/3.png', 'l/1.png', 'l/2.png', 'other/9.png']) await blobs.put(`${p}${k}`, bytes(k), { contentType: 'image/png' });
      const first = await blobs.list({ prefix: `${p}l/`, limit: 2 });
      expect(first.blobs.map((b) => b.key)).toEqual([`${p}l/1.png`, `${p}l/2.png`]);
      expect(first.cursor).not.toBeNull();
      const second = await blobs.list({ prefix: `${p}l/`, limit: 2, cursor: first.cursor });
      expect(second.blobs.map((b) => b.key)).toEqual([`${p}l/3.png`]);
      expect(second.cursor).toBeNull();
      const all = await blobs.list({ prefix: `${p}l/` });
      expect(all.blobs).toHaveLength(3);
      expect(all.blobs[0]).toMatchObject({ size: 7, contentType: 'image/png' });
      expect(all.cursor).toBeNull();
    });
  });
}
