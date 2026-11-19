import type { Db } from '@repo/platform/ports';

import type { GalleryKeys } from './access';
import type { AssetFetcher } from './pages';

/**
 * What the gallery handler is given (plan p06 D6.5). STRUCTURAL types only — no Cloudflare type
 * (guard `platform-boundary`) — so one handler runs in two hosts:
 * - production: `worker.ts` builds it from `env` (`d1Db(env.DB)`, `env.ASSETS`, `caches.default`,
 *   `ctx.waitUntil`);
 * - development: the Next route handlers `app/g/[slug]/…` build it from `getPlatform()`.
 */

/** The part of the Cache API the handler uses (`caches.default` satisfies it). Keys are URLs. */
export type JsonCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
};

export type EdgeGalleryConfig = {
  /** The public media domain (`MEDIA_PUBLIC_BASE_URL`), no trailing slash; null when unset. */
  mediaBaseUrl: string | null;
  /** The HMAC keys derived from `SETTINGS_ENCRYPTION_KEY` (D6.9); null when it is missing or bad. */
  keys: GalleryKeys | null;
  turnstileSiteKey: string;
  /** The studio name when no `studio` row exists (`APP_NAME`). */
  appName: string;
  isDevelopment: boolean;
};

export type EdgeGalleryDeps = {
  db: Db;
  assets: AssetFetcher;
  cache: JsonCache;
  config: EdgeGalleryConfig;
  now: () => Date;
  /** Work after the response (the cache write): `ctx.waitUntil` / `getPlatform().defer`. */
  waitUntil: (promise: Promise<unknown>) => void;
};

/** A cache that never hits (development; `workers.dev`, where `caches.default` is inert anyway). */
export const NO_CACHE: JsonCache = {
  match: async () => undefined,
  put: async () => {},
};
