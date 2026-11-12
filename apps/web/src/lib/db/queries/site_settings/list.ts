import { query, statement, type Options, type Statement } from '@repo/db/client';

import { SITE_SETTING_COLUMNS, toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow } from './types';

export async function listSiteSettings(opts?: Options): Promise<SiteSettingRow[]> {
  const rows = await query<SiteSettingDbRow>(`SELECT ${SITE_SETTING_COLUMNS} FROM site_settings ORDER BY key`, [], opts);
  return rows.map(toSiteSettingRow);
}

/** Every setting, as a statement for a page loader's batch (a handful of rows). */
export function listSiteSettingsStatement(): Statement {
  return statement(`SELECT ${SITE_SETTING_COLUMNS} FROM site_settings ORDER BY key LIMIT 50`);
}
