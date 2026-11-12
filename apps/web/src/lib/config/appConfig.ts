import 'server-only';

import { getPlatform } from '@repo/platform/current';
import type { Config } from '@repo/platform/ports';

/**
 * Runtime configuration the UI needs, read on the SERVER from the platform's
 * config (wrangler.jsonc `vars`, secrets, `.dev.vars` locally) and handed to client
 * components through `AppProvider` — never through a `NEXT_PUBLIC_*` variable,
 * which Next would freeze into the bundle at build time. Public values only:
 * appConfig.test.ts checks that no secret reaches it.
 */
export type AppConfig = {
  appName: string;
  /** Cloudflare Turnstile site key (public by design). */
  turnstileSiteKey: string;
};

/** The public part of a Config (pure). */
export function toAppConfig(config: Config): AppConfig {
  return { appName: config.appName, turnstileSiteKey: config.turnstile.siteKey };
}

export function getAppConfig(): AppConfig {
  return toAppConfig(getPlatform().config());
}
