import * as React from 'react';
import { twMerge } from './cn';

import { Eyebrow, Heading, Lead, type TextTone } from './typography';

/**
 * Layout primitives: the content column, a page section with its standard
 * header (eyebrow → title → lead), cards and chips. Surfaces are named after
 * the design's backgrounds so a page reads like the design file.
 */

/** The 1200 px content column with the responsive side gutter (16 → 24 → 32 px). */
export function Container({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={twMerge('mx-auto w-full max-w-content px-4 sm:px-6 lg:px-8', className)} {...rest}>
      {children}
    </div>
  );
}

export type Surface = 'white' | 'page' | 'lavender' | 'cream' | 'brand' | 'accent';

const SURFACE: Record<Surface, string> = {
  white: 'bg-white',
  page: 'bg-page',
  lavender: 'bg-brand-wash',
  cream: 'bg-accent-wash',
  // brand-strong: white body text on #5976D3 is 4.2:1 (below AA).
  brand: 'bg-brand-strong text-white',
  accent: 'bg-accent',
};

/** A full-width page section on one of the design's surfaces, with the content column inside. */
export function Section({
  surface = 'white',
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
    <Tag className={twMerge('relative py-14 lg:py-section', SURFACE[surface], className)} {...rest}>
      <Container className={containerClassName}>{children}</Container>
    </Tag>
  );
}

/** The eyebrow → title → lead block every section opens with. */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  titleId,
  inverse = false,
  as = 'h2',
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Give the title an id to label the section (`aria-labelledby`). */
  titleId?: string;
  /** Text colours for a brand surface. */
  inverse?: boolean;
  as?: 'h1' | 'h2';
  className?: string;
}) {
  const toneEyebrow: TextTone = inverse ? 'inverse' : 'brand';
  return (
    <header className={twMerge('flex max-w-[1100px] flex-col gap-3', className)}>
      {eyebrow ? <Eyebrow tone={toneEyebrow}>{eyebrow}</Eyebrow> : null}
      <Heading id={titleId} as={as} level={2} tone={inverse ? 'inverse' : 'ink'}>
        {title}
      </Heading>
      {lead ? <Lead tone={inverse ? 'onBrand' : 'muted'}>{lead}</Lead> : null}
    </header>
  );
}

export type CardTone = 'white' | 'outline' | 'lavender' | 'lavenderSoft' | 'cream' | 'brand' | 'accent';

const CARD: Record<CardTone, string> = {
  white: 'bg-white',
  outline: 'border border-brand-border bg-white',
  lavender: 'bg-brand-tint',
  lavenderSoft: 'bg-brand-wash',
  cream: 'bg-accent-wash',
  brand: 'bg-brand-strong text-white',
  accent: 'bg-accent',
};

/** A rounded (24 px) surface. Padding is the caller's: cards differ (24/28/32/40 px). */
export function Card({
  tone = 'white',
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
    <Tag className={twMerge('relative overflow-hidden rounded-3xl', CARD[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

export type ChipTone = 'white' | 'subtle' | 'onBrand' | 'accent';

const CHIP: Record<ChipTone, string> = {
  white: 'bg-white text-brand-strong',
  subtle: 'bg-brand-subtle text-brand-deep',
  onBrand: 'bg-brand-deep text-white',
  accent: 'bg-accent text-ink',
};

/** A small fact tag ("Saturday", "90 min") — 8 px radius, bold 12 px. */
export function Chip({
  tone = 'white',
  pill = false,
  className,
  children,
}: {
  tone?: ChipTone;
  /** Fully rounded (a status badge). */
  pill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={twMerge(
        'inline-flex items-center font-sans font-bold',
        pill ? 'rounded-full px-3.5 py-2 text-body-sm' : 'rounded-lg px-2.5 py-2.5 text-caption leading-none',
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The short yellow bar under a page title. */
export function AccentBar({ className }: { className?: string }) {
  return <span aria-hidden className={twMerge('block h-1.5 w-28 rounded-full bg-accent', className)} />;
}
