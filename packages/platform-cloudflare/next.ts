import 'server-only';

import { getCloudflareContext } from '@opennextjs/cloudflare';

import type { Platform } from '@repo/platform/ports';

import { cloudflarePlatform } from './platform';

/**
 * The platform for Next code (re-exported by `@repo/platform/current`): the request's
 * `getCloudflareContext()`, read per call. One platform per `env` object (one per isolate, one in
 * `next dev`), kept on `globalThis` because Next's server build may duplicate this module.
 * `ctx` is per request, so it is looked up when work is deferred, never captured.
 *
 * Only inside a request: `getCloudflareContext()` throws at import time and during `next build`.
 */
const KEY = Symbol.for('memoria.platform.cloudflare');
type Holder = { [KEY]?: WeakMap<object, Platform> };
const holder = globalThis as Holder;

export function getPlatform(): Platform {
  const { env } = getCloudflareContext();
  const cache = (holder[KEY] ??= new WeakMap());
  let platform = cache.get(env);
  if (!platform) {
    platform = cloudflarePlatform(env, (task) => getCloudflareContext().ctx.waitUntil(task));
    cache.set(env, platform);
  }
  return platform;
}
