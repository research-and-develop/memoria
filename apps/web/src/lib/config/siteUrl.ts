import 'server-only';

import { headers } from 'next/headers';

import { getStudio } from '@/lib/settings/studio.cached';

/**
 * The site's absolute origin for canonical URLs, OpenGraph and the sitemap:
 * the website address from Settings → Studio (else SITE_URL), else the origin
 * of the current request (workers.dev, preview, localhost).
 */
export async function getSiteUrl(): Promise<string> {
  const configured = (await getStudio()).siteUrl;
  if (configured) return configured;
  return requestOrigin(await headers());
}

export function requestOrigin(h: Headers): string {
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3210';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
