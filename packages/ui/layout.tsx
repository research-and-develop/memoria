import * as React from 'react';
import { twMerge } from './cn';

/**
 * Layout primitives: the content column, page sections, cards and pills. Every colour is a theme
 * role (theme/studio.mjs); the maps below only pick roles, so a restyle is a theme edit and a new
 * tone is one line.
 */

/** The content column with the responsive side gutter (16 → 24 → 32 px). */
export function Container({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={twMerge('mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8', className)} {...rest}>
      {children}
    </div>
  );
}

/** The backgrounds a full-width section can sit on. */
export type Surface = 'ground' | 'surface';

const SURFACE: Record<Surface, string> = {
  ground: 'bg-ground',
  surface: 'bg-surface',
};

/** A full-width page section on a surface, with the content column inside. */
export function Section({
  surface = 'surface',
  as,
  className,
  containerClassName,
  children,
  ...rest
}: {
  surface?: Surface;
  as?: React.ElementType;
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const Tag = as ?? 'section';
  return (
    <Tag className={twMerge('relative py-10 lg:py-14', SURFACE[surface], className)} {...rest}>
      <Container className={containerClassName}>{children}</Container>
    </Tag>
  );
}

export type CardTone = 'surface' | 'wash';

const CARD: Record<CardTone, string> = {
  surface: 'border border-line bg-surface',
  wash: 'bg-wash',
};

/** A rounded card. Padding is the caller's: cards differ. */
export function Card({
  tone = 'surface',
  as,
  className,
  children,
  ...rest
}: { tone?: CardTone; as?: React.ElementType; className?: string; children?: React.ReactNode } & Omit<
  React.HTMLAttributes<HTMLElement>,
  'className' | 'children'
>) {
  const Tag = as ?? 'div';
  return (
    <Tag className={twMerge('relative rounded-card', CARD[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Gallery statuses, plus the neutral, accent and alert pills. */
export type PillTone = 'live' | 'proofing' | 'draft' | 'scheduled' | 'expired' | 'neutral' | 'accent' | 'alert';

const PILL_TONE: Record<PillTone, string> = {
  live: 'bg-live-bg text-live-fg',
  proofing: 'bg-proofing-bg text-proofing-fg',
  draft: 'bg-draft-bg text-draft-fg',
  scheduled: 'bg-scheduled-bg text-scheduled-fg',
  expired: 'bg-expired-bg text-expired-fg',
  neutral: 'bg-wash text-ink-2',
  accent: 'bg-accent-tint text-accent-ink',
  // `alert` text is AA on `surface` only.
  alert: 'bg-surface text-alert ring-1 ring-line',
};

const PILL_SIZE = {
  md: 'px-2.5 py-1 text-caption',
  sm: 'px-2 py-0.5 text-micro',
} as const;

/** A small rounded label: a gallery's status, a count, a tag. */
export function Pill({
  tone = 'neutral',
  size = 'md',
  className,
  children,
}: {
  tone?: PillTone;
  size?: keyof typeof PILL_SIZE;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={twMerge(
        'inline-flex items-center whitespace-nowrap rounded-full font-sans font-semibold',
        PILL_SIZE[size],
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
