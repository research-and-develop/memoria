import { afterEach, describe, expect, it } from 'vitest';

import { memoryBlobStore } from '../memory/blobStore';
import type { Db } from '../ports';
import { flushDeferred, resetTestPlatform, setTestDb, testPlatform, useTestPlatform } from './platform';

const fakeDb = {} as Db;

afterEach(() => resetTestPlatform());

describe('the test platform', () => {
  it('is named test and has no db until one is installed', () => {
    expect(testPlatform.name).toBe('test');
    expect(() => testPlatform.db()).toThrow(/no test db/);
    setTestDb(fakeDb);
    expect(testPlatform.db()).toBe(fakeDb);
    setTestDb(null);
    expect(() => testPlatform.db()).toThrow(/no test db/);
  });

  it('parses the env live on every call', () => {
    const env: Record<string, string> = { ADMIN_EMAIL: 'a@b.c' };
    useTestPlatform({ env });
    expect(testPlatform.config().admin.email).toBe('a@b.c');
    env.ADMIN_EMAIL = 'X@Y.Z';
    expect(testPlatform.config().admin.email).toBe('x@y.z');
  });

  it('uses the given parts, and a fresh memory store by default', async () => {
    const blobs = memoryBlobStore();
    useTestPlatform({ db: fakeDb, blobs });
    expect(testPlatform.db()).toBe(fakeDb);
    expect(testPlatform.blobs()).toBe(blobs);
    useTestPlatform();
    expect(testPlatform.blobs()).not.toBe(blobs);
    await testPlatform.blobs().put('dev/a.png', new Uint8Array([1]), { contentType: 'image/png' });
    resetTestPlatform();
    expect(await testPlatform.blobs().head('dev/a.png')).toBeNull();
  });

  it('flushes deferred work and rethrows the first failure', async () => {
    let done = false;
    testPlatform.defer(Promise.resolve().then(() => (done = true)));
    await flushDeferred();
    expect(done).toBe(true);

    testPlatform.defer(Promise.reject(new Error('boom')));
    testPlatform.defer(Promise.resolve());
    await expect(flushDeferred()).rejects.toThrow('boom');
    await expect(flushDeferred()).resolves.toBeUndefined();
  });
});
