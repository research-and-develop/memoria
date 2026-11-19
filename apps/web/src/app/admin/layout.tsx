import type { Metadata } from 'next';

import { AppProvider } from '@/components/AppProvider';
import { getAppConfig } from '@/lib/config/appConfig';
import { getSiteUrl } from '@/lib/config/siteUrl';

// Every admin page reads the Worker env (and D1) per request. Next never caches a page itself here;
// add caching deliberately (docs/recipes.md → Caching).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { appName } = await getAppConfig();
  return {
    metadataBase: new URL(await getSiteUrl()),
    title: { default: appName, template: `%s | ${appName}` },
  };
}

/**
 * Everything under /admin (the panel and the sign-in page): the per-request config and the
 * `AppProvider` the client components read (the Turnstile site key). The root layout is static (plan
 * p06 D6.2), so this is where the admin's dynamic rendering is declared.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const config = await getAppConfig();
  return <AppProvider config={config}>{children}</AppProvider>;
}
