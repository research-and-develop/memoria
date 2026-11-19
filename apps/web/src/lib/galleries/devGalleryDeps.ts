import 'server-only';

import { getPlatform } from '@repo/platform/current';

import { galleryConfig } from '@/lib/edge/gallery/config';
import { NO_CACHE, type EdgeGalleryDeps } from '@/lib/edge/gallery/deps';
import { GALLERY_PAGES, UNAVAILABLE_HTML } from '@/lib/edge/gallery/markers.mjs';
import type { AssetFetcher } from '@/lib/edge/gallery/pages';
import { readStudio } from '@/lib/settings/studio';

/**
 * The gallery handler's deps under `next dev` (plan p06 D6.5), for the development route handlers
 * `app/g/[slug]/…` (`next dev` never runs `worker.ts`). Same handler, same D1, different host:
 * - the shell is the `/gallery-shell` page Next renders (it carries the same markers); the 404 page
 *   is Next's own not-found page, the 503 page the shared template;
 * - no cache (like `workers.dev`); deferred work through `getPlatform().defer`;
 * - the studio name's fallback through `readStudio()` (guard `settings-through-store`).
 */
function devAssets(origin: string): AssetFetcher {
  const page = async (path: string): Promise<Response> => {
    try {
      // Next answers the not-found page with 404: the handler wants the page itself.
      return new Response(await (await fetch(new URL(path, origin))).text(), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  return async (path) => {
    if (path === GALLERY_PAGES.shell) return page('/gallery-shell');
    if (path === GALLERY_PAGES.notFound) return page('/__gallery/not-found');
    if (path === GALLERY_PAGES.unavailable) return new Response(UNAVAILABLE_HTML, { status: 200 });
    return new Response(null, { status: 404 });
  };
}

export async function devGalleryDeps(request: Request): Promise<EdgeGalleryDeps> {
  const platform = getPlatform();
  const config = platform.config();
  return {
    db: platform.db(),
    assets: devAssets(new URL(request.url).origin),
    cache: NO_CACHE,
    config: await galleryConfig({
      mediaBaseUrl: config.media.publicBaseUrl,
      secret: config.settingsKey,
      turnstileSiteKey: config.turnstile.siteKey,
      appName: (await readStudio()).name,
      isDevelopment: config.isDevelopment,
    }),
    now: () => new Date(),
    waitUntil: (promise) => platform.defer(promise),
  };
}
