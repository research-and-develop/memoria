import { describe, expect, it } from 'vitest';

import { describeBlobStoreContract } from '@repo/platform/contract/blobStore';

import { r2BlobStore } from './r2';
import { createProxy } from './testing/proxy';

describeBlobStoreContract('R2 media (workerd)', () => createProxy());
describeBlobStoreContract('R2 originals (workerd)', async () => {
  const proxy = await createProxy();
  return { blobs: proxy.originals, dispose: proxy.dispose };
});

describe('the two buckets (workerd)', () => {
  it('are separate: an object put in one is absent from the other', async () => {
    const proxy = await createProxy();
    try {
      await proxy.originals.put('galleries/g/p/original.jpg', new Uint8Array([1, 2]), { contentType: 'image/jpeg' });
      expect(await proxy.blobs.head('galleries/g/p/original.jpg')).toBeNull();
      expect((await proxy.originals.head('galleries/g/p/original.jpg'))?.size).toBe(2);
    } finally {
      await proxy.dispose();
    }
  });
});

describe('r2BlobStore.delete', () => {
  it('splits a long key list into calls of at most 1000 keys (R2 refuses more)', async () => {
    const calls: number[] = [];
    const bucket = { delete: async (keys: string[]) => void calls.push(keys.length) } as unknown as R2Bucket;
    await r2BlobStore(bucket).delete(Array.from({ length: 2001 }, (_, i) => `dev/k${i}.png`));
    expect(calls).toEqual([1000, 1000, 1]);
  });
});
