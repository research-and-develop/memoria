import { queryFirst, type Options } from '@repo/db/client';

import { SITE_SETTING_COLUMNS, toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow } from './types';

export async function getSiteSetting(key: string, opts?: Options): Promise<SiteSettingRow | null> {
  const row = await queryFirst<SiteSettingDbRow>(
    `SELECT ${SITE_SETTING_COLUMNS} FROM site_settings WHERE key = ?`,
    [key],
    opts,
  );
  return row ? toSiteSettingRow(row) : null;
}
