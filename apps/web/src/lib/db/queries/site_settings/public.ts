import { statement } from '@repo/db/statement';
import type { Statement } from '@repo/platform/ports';

import { SITE_SETTING_COLUMNS, toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow } from './types';

/**
 * The public read of this table (plan p06 D6.6, D6.8): what `worker.ts` reads per gallery view — the
 * `studio` row (name and website, so a rename shows at once). EDGE-SAFE: it imports only
 * `@repo/db/statement`, types and the import-free `./types`; code under `src/lib/edge/**` imports it
 * BY PATH (`…/site_settings/public`), never through the `index.ts` barrel (which reaches
 * `@repo/db/client`). Guard: `edge-graph`. The caller runs it on the `Db` port it holds and parses
 * the value (Phase 6's handler: the studio name and website only).
 */
export function studioSettingStatement(): Statement {
  return statement(`SELECT ${SITE_SETTING_COLUMNS} FROM site_settings WHERE key = ?`, ['studio']);
}

export { toSiteSettingRow, type SiteSettingDbRow, type SiteSettingRow };
