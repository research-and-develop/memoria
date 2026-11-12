import { describe, expect, it, vi } from 'vitest';

import { stringEnv } from './env';
import { cloudflarePlatform } from './platform';

const fakeD1 = {} as D1Database;

describe('stringEnv', () => {
  it('keeps string vars and secrets and drops bindings', () => {
    expect(stringEnv({ DB: fakeD1, APP_NAME: 'X', CF_VERSION_METADATA: { id: '1' }, EMPTY: '' })).toEqual({ APP_NAME: 'X', EMPTY: '' });
  });
});

describe('cloudflarePlatform', () => {
  it('reads config from the string env', () => {
    const env = { DB: fakeD1, ADMIN_EMAIL: ' A@B.C ' };
    const platform = cloudflarePlatform(env, () => {});
    expect(platform.name).toBe('cloudflare');
    expect(platform.config().admin.email).toBe('a@b.c');
  });

  it('hands deferred work to waitUntil at call time, with failures caught', async () => {
    const waitUntil = vi.fn<(task: Promise<unknown>) => void>();
    const platform = cloudflarePlatform({ DB: fakeD1 }, waitUntil);
    expect(waitUntil).not.toHaveBeenCalled();
    platform.defer(Promise.reject(new Error('boom')));
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
  });

  it('has no blob store until the R2 binding exists', () => {
    expect(() => cloudflarePlatform({ DB: fakeD1 }, () => {}).blobs()).toThrow(expect.objectContaining({ code: 'MEDIA_NOT_CONFIGURED' }));
  });
});
