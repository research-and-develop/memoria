import { afterEach, describe, expect, it } from 'vitest';

import { getPlatform } from '@repo/platform/current';

import { flushDeferred, resetTestPlatform } from './platform';

afterEach(() => resetTestPlatform());

describe('@repo/platform/current under vitest', () => {
  it('is the test platform (the alias in vitest.config.ts works)', () => {
    expect(getPlatform().name).toBe('test');
  });

  it('fails flushDeferred() with a deferred task that rejected', async () => {
    getPlatform().defer(Promise.reject(new Error('lost work')));
    await expect(flushDeferred()).rejects.toThrow('lost work');
  });
});
