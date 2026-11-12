import { extendTailwindMerge } from 'tailwind-merge';

import studio from './theme/studio.mjs';

/**
 * tailwind-merge taught the theme's custom tokens. Without this it reads `text-heading` as a
 * COLOUR (so `twMerge('text-body', 'text-heading')` keeps both and the stylesheet order, not the
 * caller, decides), keeps both `rounded-lg rounded-card`, reads `shadow-control` as a shadow colour
 * and `font-title` as a font family. Import `twMerge` from here, never from 'tailwind-merge'.
 *
 * The lists come from `theme/studio.mjs`, the same source as the preset, so a new token needs no
 * edit here; cn.test.ts checks the preset agrees and that the merges behave.
 */
export const FONT_SIZE_TOKENS: readonly string[] = Object.keys(studio.fontSize);
export const FONT_WEIGHT_TOKENS: readonly string[] = Object.keys(studio.fontWeight);
export const RADIUS_TOKENS: readonly string[] = Object.keys(studio.borderRadius);
export const SHADOW_TOKENS: readonly string[] = Object.keys(studio.boxShadow);
export const WIDTH_TOKENS: readonly string[] = Object.keys(studio.width);
/** The preset's custom spacing keys (`theme.extend.spacing`): none today. */
export const SPACING_TOKENS: readonly string[] = [];

export const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [...SPACING_TOKENS],
      borderRadius: [...RADIUS_TOKENS],
    },
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_TOKENS] }],
      'font-weight': [{ font: [...FONT_WEIGHT_TOKENS] }],
      shadow: [{ shadow: [...SHADOW_TOKENS] }],
      w: [{ w: [...WIDTH_TOKENS] }],
    },
  },
});
