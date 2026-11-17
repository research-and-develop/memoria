import 'server-only';

import type { Options } from '@repo/db/client';

import { BRANDING_DEFAULTS, parseBrandingInput, type Branding } from './parseBrandingInput';
import { readSettingRow } from './readSettingRow';

export type { Branding } from './parseBrandingInput';

/** The `site_settings` key of the branding (plan p04 D4.2). */
export const BRANDING_SETTING_KEY = 'branding';

/**
 * The studio's branding: the `branding` row, else the built-in default (no env default). Never
 * throws. In M1 nothing writes the row (Settings → Branding is M2), so this returns the defaults
 * unless a row was inserted by hand. React-free; server components use `getBranding()`.
 */
export function readBranding(opts?: Options): Promise<Branding> {
  return readSettingRow(BRANDING_SETTING_KEY, (value) => parseBrandingInput(value, { stored: true }), () => ({ ...BRANDING_DEFAULTS }), opts);
}
