import type { Metadata } from 'next';

import { Section } from '@repo/ui/layout';
import { Heading } from '@repo/ui/typography';

import { getAppConfig } from '@/lib/config/appConfig';
import { getSiteUrl } from '@/lib/config/siteUrl';

// Reads the studio name from D1 per request; the root layout is static (plan p06 D6.2).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { appName } = await getAppConfig();
  return { metadataBase: new URL(await getSiteUrl()), title: appName };
}

/**
 * The home page: the product name only. Client galleries are `/g/<slug>`, answered by `worker.ts`
 * (plan p06); nothing here is indexed (`X-Robots-Tag`, lib/security/headers.mjs).
 */
export default async function HomePage() {
  const { appName } = await getAppConfig();
  return (
    <main>
      <Section surface="ground">
        <Heading level={1}>{appName}</Heading>
      </Section>
    </main>
  );
}
