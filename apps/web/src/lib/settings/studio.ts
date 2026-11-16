import 'server-only';

import { batch, type Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';

import { auditStatement } from '@/lib/db/queries/audit_log';
import { getSiteSetting, upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';

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
  const fallback = studioDefaults();
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
  return withDefaults(parsed.value, fallback);
}

/** APP_NAME / SITE_URL: what an empty studio setting falls back to (D2b.2). */
export function studioDefaults(): Studio {
  const { bootstrap } = getPlatform().config();
  return { name: bootstrap.appName, siteUrl: bootstrap.siteUrl };
}

/** A saved value as it takes effect: an empty address means SITE_URL. */
export function withDefaults(saved: Studio, defaults: Studio = studioDefaults()): Studio {
  return { name: saved.name, siteUrl: saved.siteUrl ?? defaults.siteUrl };
}

/**
 * Save the studio settings with their audit row, in one batch. `fields` names
 * what changed (the audit's details); the values themselves are not logged.
 */
export async function saveStudio(value: Studio, fields: readonly (keyof Studio)[], opts?: Options): Promise<void> {
  await batch(
    [
      upsertSiteSettingStatement(STUDIO_SETTING_KEY, value),
      auditStatement({ action: 'update', entity: 'site_settings', entityId: STUDIO_SETTING_KEY, summary: 'Changed the studio settings', details: { fields } }),
    ],
    opts,
  );
}
