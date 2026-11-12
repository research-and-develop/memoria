import { buttonClassName } from '@repo/ui/button';
import { Section } from '@repo/ui/layout';
import { Eyebrow, Heading, Text } from '@repo/ui/typography';

export const metadata = { title: 'Page not found', robots: { index: false } };

/** 404 for every route. */
export default function NotFound() {
  return (
    <main>
      <Section surface="ground" className="min-h-[60vh]">
        <div className="flex max-w-prose flex-col items-start gap-4">
          <Eyebrow>Error 404</Eyebrow>
          <Heading level={1}>Page not found</Heading>
          <Text as="p" size="body-lg" tone="muted">
            The address may be mistyped, or the page has moved.
          </Text>
          <a href="/" className={buttonClassName({ variant: 'primary' })}>
            Go to the home page
          </a>
        </div>
      </Section>
    </main>
  );
}
