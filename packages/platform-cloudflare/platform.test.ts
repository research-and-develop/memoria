import { describe, expect, it, vi } from 'vitest';

import { stringEnv } from './env';
import { cloudflarePlatform, relayJobs } from './platform';

const fakeD1 = {} as D1Database;
const fakeR2 = {} as R2Bucket;
const fakeOriginals = {} as R2Bucket;
const bindings = { DB: fakeD1, MEDIA: fakeR2, ORIGINALS: fakeOriginals };

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
    expect(platform.config().bootstrap.adminEmail).toBe('a@b.c');
  });

  it('hands deferred work to waitUntil at call time, with failures caught', async () => {
    const waitUntil = vi.fn<(task: Promise<unknown>) => void>();
    const platform = cloudflarePlatform(bindings, waitUntil);
    expect(waitUntil).not.toHaveBeenCalled();
    platform.defer(Promise.reject(new Error('boom')));
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
  });

  it('returns one R2 store per bucket, media by default', () => {
    const platform = cloudflarePlatform(bindings, () => {});
    expect(platform.blobs()).toBe(platform.blobs());
    expect(platform.blobs()).toBe(platform.blobs('media'));
    expect(platform.blobs('originals')).toBe(platform.blobs('originals'));
    expect(platform.blobs('originals')).not.toBe(platform.blobs('media'));
    expect(typeof platform.blobs().put).toBe('function');
  });
});

describe('the nudge (relayJobs)', () => {
  const relay = (impl: (url: string, init?: RequestInit) => Promise<Response>) => ({ fetch: vi.fn(impl) }) as unknown as Fetcher & { fetch: ReturnType<typeof vi.fn> };

  it('POSTs /run through the RELAY binding', async () => {
    const binding = relay(async () => new Response(null, { status: 202 }));
    await cloudflarePlatform({ ...bindings, RELAY: binding }, () => {}).jobs().nudge();
    expect(binding.fetch).toHaveBeenCalledWith('https://relay/run', { method: 'POST' });
  });

  it('a rejecting or failing relay is swallowed and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(relayJobs(relay(async () => Promise.reject(new Error('down')))).nudge()).resolves.toBeUndefined();
    await expect(relayJobs(relay(async () => new Response(null, { status: 500 }))).nudge()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('without the binding (the relay itself) it does nothing', async () => {
    await expect(cloudflarePlatform(bindings, () => {}).jobs().nudge()).resolves.toBeUndefined();
  });
});
