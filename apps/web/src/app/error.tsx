'use client';

import { Button } from '@repo/ui/button';
import { Section } from '@repo/ui/layout';
import { Display, Lead } from '@repo/ui/typography';

/**
 * A page that threw while rendering. Minimal on purpose — the chrome may be
 * what failed. `digest` is the id Next logs server-side, for the logs search.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <Section surface="lavender" className="min-h-[60vh]">
        <div className="flex max-w-prose flex-col items-start gap-6">
          <Display>Something went wrong</Display>
          <Lead size="lg">The page could not be loaded. Please try again in a moment.</Lead>
          {error.digest ? <p className="text-caption text-ink-muted">Code: {error.digest}</p> : null}
          <div className="flex flex-wrap gap-4">
            <Button variant="accent" onClick={reset}>
              Try again
            </Button>
            <a href="/" className="inline-flex h-[52px] items-center rounded-xl px-4 font-bold text-brand-strong hover:underline">
              Go to the home page
            </a>
          </div>
        </div>
      </Section>
    </main>
  );
}
