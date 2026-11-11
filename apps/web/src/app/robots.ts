import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/config/siteUrl';

export const dynamic = 'force-dynamic';

/**
 * Crawlers may fetch public pages (link-preview bots must, for shared gallery links) but every
 * response says `X-Robots-Tag: noindex, nofollow` (lib/security/headers.mjs), so nothing is indexed.
 * The admin and the API are disallowed outright.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getSiteUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    host: origin,
  };
}
