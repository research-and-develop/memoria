import { buttonClassName } from '@repo/ui/button';
import { Section } from '@repo/ui/layout';
import { Display, Eyebrow, Lead } from '@repo/ui/typography';

export const metadata = { title: 'Page not found', robots: { index: false } };

/** 404 for every route. */
export default function NotFound() {
  return (
    <main>
      <Section surface="lavender" className="min-h-[60vh]">
        <div className="flex max-w-prose flex-col items-start gap-6">
          <Eyebrow>Error 404</Eyebrow>
          <Display>Page not found</Display>
          <Lead size="lg">The address may be mistyped, or the page has moved.</Lead>
          <a href="/" className={buttonClassName({ variant: 'accent' })}>
            Go to the home page
          </a>
        </div>
      </Section>
    </main>
  );
}
