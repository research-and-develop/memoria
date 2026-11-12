import 'server-only';

import { headers } from 'next/headers';

import { getPlatform } from '@repo/platform/current';

/**
 * The site's absolute origin for canonical URLs, OpenGraph and the sitemap:
 * `SITE_URL` (wrangler.jsonc var, set once the domain is live),
 * else the origin of the current request (workers.dev, preview, localhost).
 */
export async function getSiteUrl(): Promise<string> {
  const configured = getPlatform().config().siteUrl;
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3210';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
