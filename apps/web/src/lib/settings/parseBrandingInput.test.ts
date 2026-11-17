import { describe, expect, it } from 'vitest';

import { BRANDING_DEFAULTS, parseBrandingInput } from './parseBrandingInput';

describe('parseBrandingInput', () => {
  it.each([
    [{}, BRANDING_DEFAULTS],
    [null, BRANDING_DEFAULTS],
    [{ accent: 'navy', theme: 'dark', font: 'editorial', grid: 'square' }, { accent: 'navy', theme: 'dark', font: 'editorial', grid: 'square' }],
    [{ theme: 'light' }, { ...BRANDING_DEFAULTS, theme: 'light' }],
  ])('%j → %j', (input, expected) => {
    expect(parseBrandingInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [{ accent: 'teal-ish' }, 'accent'],
    [{ accent: 3 }, 'accent'],
    [{ theme: 'sepia' }, 'theme'],
    [{ font: 'comic' }, 'font'],
    [{ grid: 'list' }, 'grid'],
  ])('typed input %j is refused on %s', (input, field) => {
    expect(parseBrandingInput(input)).toMatchObject({ ok: false, field });
  });

  it('a stored row with a removed swatch or pairing reads them as the defaults, keeping the rest', () => {
    expect(parseBrandingInput({ accent: 'gone', font: 'gone', theme: 'dark' }, { stored: true })).toEqual({
      ok: true,
      value: { ...BRANDING_DEFAULTS, theme: 'dark' },
    });
  });

  it('a stored row with a wrong type or an unknown theme is still invalid', () => {
    expect(parseBrandingInput({ accent: 7 }, { stored: true })).toMatchObject({ ok: false, field: 'accent' });
    expect(parseBrandingInput({ theme: 'sepia' }, { stored: true })).toMatchObject({ ok: false, field: 'theme' });
  });
});
