import * as React from 'react';
import { twMerge } from './cn';

/**
 * Typography primitives: the single source of truth for text styling.
 *
 * Screens never hand-write sizes, weights or text colours; they pick a primitive and a tone. The
 * values live in theme/studio.mjs; the maps below only say which token each option uses, so a
 * restyle is a theme edit, and a new option is one line here.
 *
 * Every primitive forwards `className` through tailwind-merge, so a genuine one-off can still
 * override a token without forking the component.
 */

type Polymorphic<P> = P & { as?: React.ElementType; className?: string; children?: React.ReactNode } & Omit<
    React.HTMLAttributes<HTMLElement>,
    keyof P | 'className' | 'children'
  >;

/** Text colours by purpose. `accentInk` is for text on an accent tint; `inverse` for a filled surface. */
export type TextTone = 'ink' | 'ink2' | 'muted' | 'accent' | 'accentInk' | 'danger' | 'alert' | 'inverse';

export const TEXT_TONE: Record<TextTone, string> = {
  ink: 'text-ink',
  ink2: 'text-ink-2',
  muted: 'text-ink-muted',
  accent: 'text-accent',
  accentInk: 'text-accent-ink',
  danger: 'text-danger',
  alert: 'text-alert',
  inverse: 'text-inverse',
};

export type FontWeight = 'normal' | 'medium' | 'semibold' | 'title' | 'bold';

const FONT_WEIGHT: Record<FontWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  title: 'font-title',
  bold: 'font-bold',
};

export type HeadingLevel = 1 | 2 | 3 | 4;
export type HeadingSize = 'title-sm' | 'title' | 'title-lg' | 'heading' | 'heading-lg' | 'stat';

const HEADING_SIZE: Record<HeadingSize, string> = {
  'title-sm': 'text-title-sm',
  title: 'text-title',
  'title-lg': 'text-title-lg',
  heading: 'text-heading',
  'heading-lg': 'text-heading-lg',
  stat: 'text-stat',
};

/** Default size per level: 1 page greeting, 2 screen title, 3 section title, 4 card title. */
const LEVEL_SIZE: Record<HeadingLevel, HeadingSize> = { 1: 'heading-lg', 2: 'title-lg', 3: 'title', 4: 'title-sm' };

/** Default weight per size: titles 650, the large headings bold. */
const SIZE_WEIGHT: Record<HeadingSize, FontWeight> = {
  'title-sm': 'title',
  title: 'title',
  'title-lg': 'title',
  heading: 'bold',
  'heading-lg': 'bold',
  stat: 'bold',
};

/** A heading. `level` sets the element (h1–h4) and the default size; `as` changes only the element. */
export function Heading({
  level = 2,
  size,
  weight,
  tone = 'ink',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ level?: HeadingLevel; size?: HeadingSize; weight?: 'title' | 'bold'; tone?: TextTone }>) {
  const Tag = as ?? (`h${level}` as React.ElementType);
  const size_ = size ?? LEVEL_SIZE[level];
  return (
    <Tag
      className={twMerge(
        'font-sans text-balance break-words',
        HEADING_SIZE[size_],
        FONT_WEIGHT[weight ?? SIZE_WEIGHT[size_]],
        TEXT_TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type TextSize = 'micro' | 'caption' | 'body-sm' | 'body' | 'body-lg';

const TEXT_SIZE: Record<TextSize, string> = {
  micro: 'text-micro',
  caption: 'text-caption',
  'body-sm': 'text-body-sm',
  body: 'text-body',
  'body-lg': 'text-body-lg',
};

/** Body or inline text. A <span> by default; pass `as="p"` for a paragraph. */
export function Text({
  size = 'body',
  tone = 'ink',
  weight = 'normal',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ size?: TextSize; tone?: TextTone; weight?: FontWeight }>) {
  const Tag = as ?? 'span';
  return (
    <Tag className={twMerge('font-sans', TEXT_SIZE[size], FONT_WEIGHT[weight], TEXT_TONE[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** A form label (above its control). */
export function Label({ className, children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={twMerge('block font-sans text-body-sm font-semibold text-ink', className)} {...rest}>
      {children}
    </label>
  );
}

/** Small muted helper text: meta lines, hints. */
export function Caption({ className, children, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={twMerge('font-sans text-caption text-ink-muted', className)} {...rest}>
      {children}
    </p>
  );
}

/** The small uppercase label above a group ("GALLERIES"). */
export function Eyebrow({ tone = 'muted', as, className, children, ...rest }: Polymorphic<{ tone?: TextTone }>) {
  const Tag = as ?? 'p';
  return (
    <Tag className={twMerge('font-sans text-eyebrow font-semibold uppercase', TEXT_TONE[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Monospace text: filenames, codes, ids. */
export function Mono({ size = 'caption', as, className, children, ...rest }: Polymorphic<{ size?: 'caption' | 'body-sm' }>) {
  const Tag = as ?? 'span';
  return (
    <Tag className={twMerge('font-mono text-ink-2', TEXT_SIZE[size], className)} {...rest}>
      {children}
    </Tag>
  );
}
