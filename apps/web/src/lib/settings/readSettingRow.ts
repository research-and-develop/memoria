import 'server-only';

import type { Options } from '@repo/db/client';
import { logger } from '@repo/logger';

import { getSiteSetting } from '@/lib/db/queries/site_settings';

type Parse<T> = (value: unknown) => { ok: true; value: T } | { ok: false; field: string };

/**
 * A `site_settings` row through its parser, else the built-in default (plan p04 D4.2, `readStudio`'s
 * rule): never throws. A D1 error logs `<event>_settings_unavailable`, an invalid row
 * `<event>_settings_invalid` with the failing field (never the value). React-free: the relay may
 * read these rows too.
 */
export async function readSettingRow<T>(key: string, parse: Parse<T>, fallback: () => T, opts?: Options): Promise<T> {
  let value: unknown;
  try {
    value = (await getSiteSetting(key, opts))?.value;
  } catch (error) {
    logger.warn({ event: `${key}_settings_unavailable`, error });
    return fallback();
  }
  if (value === undefined) return fallback();
  const parsed = parse(value);
  if (!parsed.ok) {
    logger.warn({ event: `${key}_settings_invalid`, field: parsed.field });
    return fallback();
  }
  return parsed.value;
}
