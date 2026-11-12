import { Section } from '@repo/ui/layout';
import { Heading } from '@repo/ui/typography';

import { getAppConfig } from '@/lib/config/appConfig';

/**
 * The home page: the product name only. Client galleries get their own routes (Phase 5–6);
 * nothing here is indexed (`X-Robots-Tag`, lib/security/headers.mjs).
 */
export default function HomePage() {
  const { appName } = getAppConfig();
  return (
    <main>
      <Section surface="ground">
        <Heading level={1}>{appName}</Heading>
      </Section>
    </main>
  );
}
