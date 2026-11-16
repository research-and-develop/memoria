import { AsyncLocalStorage } from 'node:async_hooks';

import type { Platform } from '@repo/platform/ports';

/**
 * The relay Worker's composition root (plan p03, D3.3). Its `wrangler.jsonc` `alias` points
 * `@repo/platform/current` here, so the shared domain code (query modules, job handlers, templates)
 * calls the same `getPlatform()` it calls under Next.
 *
 * Each invocation (a `fetch` or a `scheduled` event) runs inside `withPlatform(platform, fn)`; the
 * platform travels with the async context, so two invocations overlapping in one isolate never see
 * each other's `env`. Outside one, `getPlatform()` throws: the same rule as under Next (only inside
 * a request, never at import time).
 *
 * Exports every name `packages/platform/current.ts` exports (guard: wrangler-config).
 */
const storage = new AsyncLocalStorage<Platform>();

export function withPlatform<T>(platform: Platform, fn: () => Promise<T>): Promise<T> {
  return storage.run(platform, fn);
}

export function getPlatform(): Platform {
  const platform = storage.getStore();
  if (!platform) throw new Error('getPlatform() outside withPlatform(): only inside a relay invocation');
  return platform;
}
