import 'server-only';

import type { Options } from '@repo/db/client';

import { GALLERY_DEFAULTS, parseGalleryDefaultsInput, type GalleryDefaults } from './parseGalleryDefaultsInput';
import { readSettingRow } from './readSettingRow';
import { readWatermark } from './watermark';

export type { GalleryDefaults } from './parseGalleryDefaultsInput';

/** The `site_settings` key of the new-gallery defaults (plan p04 D4.2). */
export const GALLERY_DEFAULTS_SETTING_KEY = 'gallery_defaults';

/**
 * The defaults of a new gallery: the `gallery_defaults` row, else the built-in defaults, with
 * `watermarkSelection` read as false while the watermark is `none` (there is nothing to bake).
 * Never throws. In M1 nothing writes the row (Settings → Galleries is M2). React-free; server
 * components use `getGalleryDefaults()`.
 */
export async function readGalleryDefaults(opts?: Options): Promise<GalleryDefaults> {
  const [defaults, watermark] = await Promise.all([
    readSettingRow(GALLERY_DEFAULTS_SETTING_KEY, parseGalleryDefaultsInput, () => structuredClone(GALLERY_DEFAULTS), opts),
    readWatermark(opts),
  ]);
  return watermark.kind === 'none' ? { ...defaults, watermarkSelection: false } : defaults;
}
