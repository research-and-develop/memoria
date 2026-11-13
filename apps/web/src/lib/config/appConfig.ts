import 'server-only';

import { getPlatform } from '@repo/platform/current';
import type { Config } from '@repo/platform/ports';

import { perRender } from '@/lib/perRender';
import { getStudio } from '@/lib/settings/studio.cached';
import type { Studio } from '@/lib/settings/studio';

/**
 * Runtime configuration the UI needs, read on the SERVER from the platform's
 * config (wrangler.jsonc `vars`, secrets, `.dev.vars` locally) and the studio
 * settings (D1), and handed to client components through `AppProvider` — never
 * through a `NEXT_PUBLIC_*` variable, which Next would freeze into the bundle at
 * build time. Public values only: appConfig.test.ts checks that no secret reaches it.
 */
export type AppConfig = {
  /** The studio's name (Settings → Studio, else APP_NAME). */
  appName: string;
  /** Cloudflare Turnstile site key (public by design). */
  turnstileSiteKey: string;
};

/** The public part of a Config and the studio settings (pure). */
export function toAppConfig(config: Config, studio: Studio): AppConfig {
  return { appName: studio.name, turnstileSiteKey: config.turnstile.siteKey };
}

/** Once per server render. */
export const getAppConfig = perRender(async (): Promise<AppConfig> => toAppConfig(getPlatform().config(), await getStudio()));
