import { firstRow, statement, type Options, type Statement } from '@repo/db/client';

import { SITE_SETTING_COLUMNS, toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow } from './types';

const UPSERT_SQL = `INSERT INTO site_settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING ${SITE_SETTING_COLUMNS}`;

/**
 * The statement alone, for a caller that must write it ATOMICALLY with others
 * (e.g. together with its audit row): `batch([upsertSiteSettingStatement(…), …])`.
 */
export function upsertSiteSettingStatement(key: string, value: unknown): Statement {
  return statement(UPSERT_SQL, [key, JSON.stringify(value)]);
}

export async function upsertSiteSetting(key: string, value: unknown, opts?: Options): Promise<SiteSettingRow> {
  const row = await firstRow<SiteSettingDbRow, SiteSettingRow>(upsertSiteSettingStatement(key, value), toSiteSettingRow, opts);
  if (!row) throw new Error(`site_settings upsert returned no row for ${key}`);
  return row;
}
