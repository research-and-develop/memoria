'use client';

import { Button, buttonClassName } from '@repo/ui/button';
import { Section } from '@repo/ui/layout';
import { Caption, Heading, Text } from '@repo/ui/typography';

/**
 * A page that threw while rendering. Minimal on purpose — the chrome may be
 * what failed. `digest` is the id Next logs server-side, for the logs search.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <Section surface="ground" className="min-h-[60vh]">
        <div className="flex max-w-prose flex-col items-start gap-4">
          <Heading level={1}>Something went wrong</Heading>
          <Text as="p" size="body-lg" tone="muted">
            The page could not be loaded. Please try again in a moment.
          </Text>
          {error.digest ? <Caption>Code: {error.digest}</Caption> : null}
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <a href="/" className={buttonClassName({ variant: 'link' })}>
              Go to the home page
            </a>
          </div>
        </div>
      </Section>
    </main>
  );
}
