import 'server-only';

import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Runtime configuration the UI needs, read on the SERVER from the Worker's env
 * (wrangler.jsonc `vars`, secrets, `.dev.vars` locally) and handed to client
 * components through `AppProvider` — never through a `NEXT_PUBLIC_*` variable,
 * which Next would freeze into the bundle at build time. Public values only.
 */
export type AppConfig = {
  appName: string;
  /** Cloudflare Turnstile site key (public by design). */
  turnstileSiteKey: string;
};

export function getAppConfig(): AppConfig {
  const { env } = getCloudflareContext();
  return {
    appName: env.APP_NAME?.trim() || 'My App',
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() ?? '',
  };
}
