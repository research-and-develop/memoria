import { describe, expect, it } from 'vitest';

import { describeBlobStoreContract } from '@repo/platform/contract/blobStore';

import { r2BlobStore } from './r2';
import { createProxy } from './testing/proxy';

describeBlobStoreContract('R2 (workerd)', () => createProxy());

describe('r2BlobStore.delete', () => {
  it('splits a long key list into calls of at most 1000 keys (R2 refuses more)', async () => {
    const calls: number[] = [];
    const bucket = { delete: async (keys: string[]) => void calls.push(keys.length) } as unknown as R2Bucket;
    await r2BlobStore(bucket).delete(Array.from({ length: 2001 }, (_, i) => `dev/k${i}.png`));
    expect(calls).toEqual([1000, 1000, 1]);
  });
});
