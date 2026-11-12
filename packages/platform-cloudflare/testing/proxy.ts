import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPlatformProxy } from 'wrangler';

import type { BlobStore, Db } from '@repo/platform/ports';

import { d1Db } from '../d1';
import { r2BlobStore } from '../r2';

/**
 * Real Cloudflare bindings for tests (D1 and R2): wrangler's `getPlatformProxy` runs workerd with the app's
 * wrangler config IN MEMORY (`persist: false`: nothing touches `.wrangler/state`). Startup is
 * about a second, so one proxy per test FILE. Test-only.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WRANGLER_CONFIG = path.join(REPO_ROOT, 'apps', 'web', 'wrangler.jsonc');

export type Proxy = { db: Db; blobs: BlobStore; dispose: () => Promise<void> };

export async function createProxy(configPath: string = WRANGLER_CONFIG): Promise<Proxy> {
  const proxy = await getPlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>({ configPath, persist: false });
  return { db: d1Db(proxy.env.DB), blobs: r2BlobStore(proxy.env.MEDIA), dispose: () => proxy.dispose() };
}
