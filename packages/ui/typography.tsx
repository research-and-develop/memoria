import * as React from 'react';
import { twMerge } from './cn';

/**
 * Typography primitives — the single source of truth for text styling.
 *
 * Screens never hand-write sizes and weights (`text-[38px]`, `font-black`);
 * they pick a primitive. The scale lives in tailwind-preset.mjs; the weight
 * rule is the design's (default: display font bold 700; text font body 400,
 * navigation 600, buttons/emphasis 700, eyebrows 800).
 *
 * Every primitive forwards `className` through tailwind-merge, so a genuine
 * one-off can still override a token without forking the component.
 */

type Polymorphic<P> = P & { as?: React.ElementType; className?: string; children?: React.ReactNode } & Omit<
    React.HTMLAttributes<HTMLElement>,
    keyof P | 'className' | 'children'
  >;

export type TextTone = 'ink' | 'muted' | 'brand' | 'inverse' | 'onBrand' | 'accent' | 'danger' | 'success';

const TONE: Record<TextTone, string> = {
  ink: 'text-ink',
  muted: 'text-ink-muted',
  // brand-strong, not brand: the base brand colour is below AA for body sizes.
  brand: 'text-brand-strong',
  inverse: 'text-white',
  onBrand: 'text-brand-on',
  accent: 'text-accent',
  danger: 'text-danger',
  success: 'text-success',
};

/** Page title (h1 by default). `xl` is the home hero, `lg` an inner page. */
export function Display({
  size = 'lg',
  tone = 'brand',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ size?: 'xl' | 'lg'; tone?: 'brand' | 'inverse' | 'ink' }>) {
  const Tag = as ?? 'h1';
  // The big display sizes pass AA as large text, so the true brand blue stays.
  const tone_ = tone === 'brand' ? 'text-brand' : TONE[tone];
  return (
    <Tag
      className={twMerge(
        'font-display font-bold text-balance break-words',
        size === 'xl' ? 'text-display-xl' : 'text-display-lg',
        tone_,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export type HeadingSize = 'xl' | 'section' | 'lg' | 'md' | 'sm' | 'xs';
type HeadingLevel = 1 | 2 | 3 | 4;

const HEADING_SIZE: Record<HeadingSize, string> = {
  xl: 'text-heading-xl',
  section: 'text-heading-section',
  lg: 'text-heading-lg',
  md: 'text-heading-md',
  sm: 'text-heading-sm',
  xs: 'text-heading-xs',
};

const LEVEL_SIZE: Record<HeadingLevel, HeadingSize> = { 1: 'xl', 2: 'section', 3: 'md', 4: 'sm' };

/**
 * A heading in the display font. `level` sets the element (h1–h4) and the
 * default size: 1 xl · 2 section title · 3 card title · 4 small title.
 */
export function Heading({
  level = 2,
  size,
  tone = 'ink',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ level?: HeadingLevel; size?: HeadingSize; tone?: TextTone }>) {
  const Tag = as ?? (`h${level}` as React.ElementType);
  // Large headings may use the true brand blue (3:1 is enough for large text).
  const toneClass = tone === 'brand' ? 'text-brand' : TONE[tone];
  return (
    <Tag
      className={twMerge('font-display font-bold text-balance break-words', HEADING_SIZE[size ?? LEVEL_SIZE[level]], toneClass, className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** The small uppercase line above a section title ("FEATURES"). */
export function Eyebrow({
  size = 'md',
  tone = 'brand',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ size?: 'md' | 'sm' | 'xs'; tone?: TextTone }>) {
  const Tag = as ?? 'p';
  return (
    <Tag
      className={twMerge(
        'font-sans font-extrabold uppercase',
        size === 'md' ? 'text-eyebrow' : size === 'sm' ? 'text-eyebrow-sm' : 'text-eyebrow-xs',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** The paragraph under a section title. `lg` is the hero/page-title lead. */
export function Lead({
  size = 'md',
  tone = 'muted',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ size?: 'md' | 'lg'; tone?: TextTone }>) {
  const Tag = as ?? 'p';
  return (
    <Tag className={twMerge('font-sans', size === 'lg' ? 'text-lead-lg' : 'text-lead', TONE[tone], className)} {...rest}>
      {children}
    </Tag>
  );
}

export type TextSize = 'lg' | 'md' | 'sm' | 'xs';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';

const TEXT_SIZE: Record<TextSize, string> = {
  lg: 'text-body-lg',
  md: 'text-body',
  sm: 'text-body-sm',
  xs: 'text-caption',
};
const TEXT_WEIGHT: Record<TextWeight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
  extrabold: 'font-extrabold',
};

/** Body / inline text in the text font. A <span> by default; pass `as="p"` for a block. */
export function Text({
  size = 'md',
  tone = 'muted',
  weight = 'normal',
  as,
  className,
  children,
  ...rest
}: Polymorphic<{ size?: TextSize; tone?: TextTone; weight?: TextWeight }>) {
  const Tag = as ?? 'span';
  return (
    <Tag className={twMerge('font-sans', TEXT_SIZE[size], TONE[tone], TEXT_WEIGHT[weight], className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Field label above an input. */
export function Label({ className, children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={twMerge('block font-sans text-label font-bold text-ink', className)} {...rest}>
      {children}
    </label>
  );
}

/** Small muted helper text under a control or heading. */
export function Caption({ className, children, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={twMerge('font-sans text-caption text-ink-muted', className)} {...rest}>
      {children}
    </p>
  );
}
