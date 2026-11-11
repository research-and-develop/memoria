/**
 * Mirrors `site_settings`, with `value` already parsed from its JSON column.
 * `updated_at` is ISO-8601 UTC text (D1 has no date type); render it on the
 * client through `@repo/ui/date`.
 */
export type SiteSettingRow = {
  key: string;
  value: unknown;
  updated_at: string;
};

/** The raw D1 row: JSON columns arrive as text. Parse in this module, never in a caller. */
export type SiteSettingDbRow = Omit<SiteSettingRow, 'value'> & { value: string };

export const SITE_SETTING_COLUMNS = 'key, value, updated_at';

export function toSiteSettingRow(row: SiteSettingDbRow): SiteSettingRow {
  return { ...row, value: JSON.parse(row.value) as unknown };
}
