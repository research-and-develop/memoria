import { Section } from '@repo/ui/layout';
import { Display, Heading, Lead } from '@repo/ui/typography';

import { ContactForm } from '@/components/contact/ContactForm';
import { getAppConfig } from '@/lib/config/appConfig';

/**
 * The home page — a server component: it reads config on the server and hands
 * only serialisable props to the client form. Replace with your own pages.
 */
export default function HomePage() {
  const { appName } = getAppConfig();
  return (
    <main>
      <Section surface="lavender">
        <div className="flex max-w-prose flex-col gap-4">
          <Display size="xl">{appName}</Display>
          <Lead size="lg">Next.js on one Cloudflare Worker: D1, Turnstile, an admin and guard tests — on the free plan.</Lead>
        </div>
      </Section>
      <Section aria-labelledby="contact-title">
        <div className="flex max-w-prose flex-col gap-6">
          <Heading id="contact-title" level={2}>
            Get in touch
          </Heading>
          <ContactForm />
        </div>
      </Section>
    </main>
  );
}
