import { describe, expect, it } from 'vitest';

import { FONT_SIZE_TOKENS, SPACING_TOKENS, twMerge } from './cn';
import preset from './tailwind-preset.mjs';

/**
 * tailwind-merge only merges the tokens it is told about: a font size added to
 * the preset but not to FONT_SIZE_TOKENS is read as a COLOUR, and
 * `twMerge('text-body', 'text-new')` silently keeps both.
 */
const theme = (preset as { theme: { extend: { fontSize: Record<string, unknown>; spacing: Record<string, unknown> } } }).theme.extend;

describe('cn knows every custom token of the preset', () => {
  it('font sizes', () => {
    expect([...FONT_SIZE_TOKENS].sort()).toEqual(Object.keys(theme.fontSize).sort());
  });

  it('spacing', () => {
    expect([...SPACING_TOKENS].sort()).toEqual(Object.keys(theme.spacing).sort());
  });

  it.each(FONT_SIZE_TOKENS)('text-%s replaces another size and keeps the colour', (token) => {
    expect(twMerge('text-body text-ink', `text-${token}`)).toBe(`text-ink text-${token}`);
  });
});
