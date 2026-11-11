import type { MetadataRoute } from 'next';

import { getSiteUrl } from '@/lib/config/siteUrl';

export const dynamic = 'force-dynamic';

/** Everything public is indexable; the admin and the API are not. Add `sitemap` once you have one. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getSiteUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    host: origin,
  };
}
