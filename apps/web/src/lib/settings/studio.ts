import 'server-only';

import type { Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { getSiteSetting } from '@/lib/db/queries/site_settings';

import { parseStudioInput, type Studio } from './parseStudioInput';

export type { Studio } from './parseStudioInput';

/** The `site_settings` key of the studio settings (D2b.9). */
export const STUDIO_SETTING_KEY = 'studio';

/**
 * The studio's name and website address: the `studio` row, else APP_NAME /
 * SITE_URL (`Config.bootstrap`), else "Memoria" / the request's origin
 * (D2b.2). A stored empty address falls back to SITE_URL.
 *
 * Never throws (D2b.10): every public page reads it, so a D1 error or an
 * invalid row logs and uses the env defaults. No React here: the relay Worker
 * (Phase 3) reads it too; server components use `getStudio()` (studio.cached.ts).
 */
export async function readStudio(opts?: Options): Promise<Studio> {
  const config = getPlatform().config();
  const fallback: Studio = { name: config.bootstrap.appName, siteUrl: config.bootstrap.siteUrl };
  let value: unknown;
  try {
    value = (await getSiteSetting(STUDIO_SETTING_KEY, opts))?.value;
  } catch (error) {
    logger.warn({ event: 'studio_settings_unavailable', error });
    return fallback;
  }
  if (value === undefined) return fallback;
  const parsed = parseStudioInput(value, { isDevelopment: config.isDevelopment });
  if (!parsed.ok) {
    logger.warn({ event: 'studio_settings_invalid', field: parsed.field });
    return fallback;
  }
  return { name: parsed.value.name, siteUrl: parsed.value.siteUrl ?? fallback.siteUrl };
}
