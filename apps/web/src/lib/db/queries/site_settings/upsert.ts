import { statement, type Options } from '@repo/db/client';

import { SITE_SETTING_COLUMNS, toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow } from './types';

const UPSERT_SQL = `INSERT INTO site_settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING ${SITE_SETTING_COLUMNS}`;

/**
 * The statement alone, for a caller that must write it ATOMICALLY with others
 * (e.g. together with its audit row): `batch([upsertSiteSettingStatement(…), …])`.
 */
export function upsertSiteSettingStatement(key: string, value: unknown, opts?: Options): D1PreparedStatement {
  return statement(UPSERT_SQL, [key, JSON.stringify(value)], opts);
}

export async function upsertSiteSetting(key: string, value: unknown, opts?: Options): Promise<SiteSettingRow> {
  const row = await upsertSiteSettingStatement(key, value, opts).first<SiteSettingDbRow>();
  if (!row) throw new Error(`site_settings upsert returned no row for ${key}`);
  return toSiteSettingRow(row);
}
