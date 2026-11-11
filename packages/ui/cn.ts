import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge taught the preset's custom tokens. Without this it reads
 * `text-heading-md` as a COLOUR, so `twMerge('text-body', 'text-heading-md')`
 * keeps both and the stylesheet order — not the caller — decides; and it does
 * not know the `section` spacing, so `lg:py-section` (Section's padding) beat
 * every caller's `lg:py-…`. Import `twMerge` from here, never from 'tailwind-merge'.
 */
export const FONT_SIZE_TOKENS = [
  'display-xl',
  'display-lg',
  'heading-xl',
  'heading-section',
  'heading-lg',
  'heading-md',
  'heading-sm',
  'heading-xs',
  'lead-lg',
  'lead',
  'body-lg',
  'body',
  'body-sm',
  'nav',
  'label',
  'caption',
  'eyebrow',
  'eyebrow-sm',
  'eyebrow-xs',
];

/** The preset's custom spacing keys (`theme.extend.spacing`). */
export const SPACING_TOKENS = ['section'];

export const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: SPACING_TOKENS,
    },
    classGroups: {
      'font-size': [{ text: FONT_SIZE_TOKENS }],
    },
  },
});
