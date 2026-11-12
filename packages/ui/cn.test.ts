import { describe, expect, it } from 'vitest';

import { FONT_SIZE_TOKENS, FONT_WEIGHT_TOKENS, RADIUS_TOKENS, SHADOW_TOKENS, SPACING_TOKENS, twMerge, WIDTH_TOKENS } from './cn';
import preset from './tailwind-preset.mjs';

/**
 * tailwind-merge only merges the tokens it is told about: a font size it does not know is read as
 * a COLOUR, and `twMerge('text-body', 'text-new')` silently keeps both. The lists in cn.ts come from
 * the theme; these tests check the preset exposes exactly those keys and that the merges behave.
 */
type Extend = Record<'fontSize' | 'fontWeight' | 'borderRadius' | 'boxShadow' | 'spacing' | 'width', Record<string, unknown> | undefined>;
const extend = (preset as unknown as { theme: { extend: Extend } }).theme.extend;
const keys = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).sort();

describe('cn knows every custom token of the preset', () => {
  it.each([
    ['font sizes', FONT_SIZE_TOKENS, 'fontSize'],
    ['font weights', FONT_WEIGHT_TOKENS, 'fontWeight'],
    ['radii', RADIUS_TOKENS, 'borderRadius'],
    ['shadows', SHADOW_TOKENS, 'boxShadow'],
    ['spacing', SPACING_TOKENS, 'spacing'],
    ['widths', WIDTH_TOKENS, 'width'],
  ] as const)('%s', (_label, tokens, key) => {
    expect([...tokens].sort()).toEqual(keys(extend[key]));
  });

  it.each(FONT_SIZE_TOKENS.filter((t) => t !== 'body'))('text-%s replaces text-body and keeps the colour', (token) => {
    expect(twMerge('text-body text-ink', `text-${token}`)).toBe(`text-ink text-${token}`);
  });

  it.each([
    ['a radius', 'rounded-lg', 'rounded-card', 'rounded-card'],
    ['a shadow', 'shadow-md', 'shadow-control', 'shadow-control'],
    ['a weight', 'font-semibold', 'font-title', 'font-title'],
    ['a width', 'w-full', 'w-sidebar', 'w-sidebar'],
    ['a family next to a weight', 'font-sans', 'font-title', 'font-sans font-title'],
    ['a colour with an opacity', 'ring-focus', 'ring-danger/25', 'ring-danger/25'],
  ])('merges %s', (_label, base, override, expected) => {
    expect(twMerge(base, override)).toBe(expected);
  });
});
