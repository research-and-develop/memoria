import 'server-only';

import type { Options, Statement } from '@repo/db/client';
import { logger } from '@repo/logger';

import { getSiteSetting, upsertSiteSettingStatement } from '@/lib/db/queries/site_settings';

/** The `site_settings` key of the security-notice switch (plan p03, D3.19): `{ enabled }`. */
export const SECURITY_NOTICES_KEY = 'security_notices';

/** Whether security notices are on: absent = on; an unreadable row = on (the safe side). */
export async function readSecurityNoticesEnabled(opts?: Options): Promise<boolean> {
  const value = (await getSiteSetting(SECURITY_NOTICES_KEY, opts))?.value;
  if (value === undefined) return true;
  if (typeof value === 'object' && value !== null && typeof (value as { enabled?: unknown }).enabled === 'boolean') return (value as { enabled: boolean }).enabled;
  logger.warn({ event: 'security_notices_setting_invalid' });
  return true;
}

export function securityNoticesStatement(enabled: boolean): Statement {
  return upsertSiteSettingStatement(SECURITY_NOTICES_KEY, { enabled });
}
