'use client';

import { useEffect, useRef } from 'react';

import { Heading } from '@repo/ui/typography';

/**
 * A sign-in step's `<h1>`. After a step change (a new server render) focus
 * moves to it, so a screen reader announces the new step; step 1 keeps the
 * focus on its first field instead (`focusOnMount={false}`).
 */
export function StepHeading({ children, focusOnMount = true }: { children: React.ReactNode; focusOnMount?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.querySelector('h1')?.focus();
  }, [focusOnMount]);
  return (
    <div ref={ref}>
      <Heading level={1} size="title-lg" tabIndex={-1} className="focus:outline-none">
        {children}
      </Heading>
    </div>
  );
}

/** An error or note at the top of a step's form, announced when it appears. */
export function FormNote({ message, tone = 'danger' }: { message: string | null; tone?: 'danger' | 'info' }) {
  return (
    <div aria-live="polite">
      {message ? (
        <p
          role={tone === 'danger' ? 'alert' : undefined}
          className={
            tone === 'danger'
              ? 'rounded-control bg-danger-wash px-4 py-3 text-body-sm font-semibold text-danger'
              : 'rounded-control bg-wash px-4 py-3 text-body-sm text-ink-2'
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
