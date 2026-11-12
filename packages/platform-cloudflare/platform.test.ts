import { describe, expect, it, vi } from 'vitest';

import { stringEnv } from './env';
import { cloudflarePlatform } from './platform';

const fakeD1 = {} as D1Database;
const fakeR2 = {} as R2Bucket;
const bindings = { DB: fakeD1, MEDIA: fakeR2 };

describe('stringEnv', () => {
  it('keeps string vars and secrets and drops bindings', () => {
    expect(stringEnv({ DB: fakeD1, APP_NAME: 'X', CF_VERSION_METADATA: { id: '1' }, EMPTY: '' })).toEqual({ APP_NAME: 'X', EMPTY: '' });
  });
});

describe('cloudflarePlatform', () => {
  it('reads config from the string env', () => {
    const env = { ...bindings, ADMIN_EMAIL: ' A@B.C ' };
    const platform = cloudflarePlatform(env, () => {});
    expect(platform.name).toBe('cloudflare');
    expect(platform.config().admin.email).toBe('a@b.c');
  });

  it('hands deferred work to waitUntil at call time, with failures caught', async () => {
    const waitUntil = vi.fn<(task: Promise<unknown>) => void>();
    const platform = cloudflarePlatform(bindings, waitUntil);
    expect(waitUntil).not.toHaveBeenCalled();
    platform.defer(Promise.reject(new Error('boom')));
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
  });

  it('returns one R2 store, built on the MEDIA binding', () => {
    const platform = cloudflarePlatform(bindings, () => {});
    expect(platform.blobs()).toBe(platform.blobs());
    expect(typeof platform.blobs().put).toBe('function');
  });
});
