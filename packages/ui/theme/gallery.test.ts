import { describe, expect, it } from 'vitest';

import { flattenColors } from './cssVars.mjs';
import * as gallery from './gallery.mjs';
import studio from './studio.mjs';

const studioRoles = flattenColors(studio.colors)
  .map(([name]) => name)
  .sort();

describe('the gallery theme', () => {
  const maps = Object.entries(gallery.ROLE_MAPS);

  it('has role maps to check', () => {
    expect(maps.map(([name]) => name)).toEqual(expect.arrayContaining(['light', 'dark']));
  });

  it.each(maps)('%s has exactly the studio roles, each #RRGGBB', (_, map) => {
    const roles = flattenColors(map);
    expect(roles.map(([name]) => name).sort()).toEqual(studioRoles);
    for (const [, hex] of roles) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('swatch ids are unique, lower-case and every hex is #RRGGBB', () => {
    const ids = gallery.SWATCHES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of gallery.SWATCHES) {
      expect(s.id).toMatch(/^[a-z]+$/);
      expect(s.hex).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(Object.isFrozen(gallery.SWATCHES)).toBe(true);
  });

  it.each([
    ['pine', 'pine'],
    ['navy', 'navy'],
    ['nope', 'pine'],
    [undefined, 'pine'],
    [42, 'pine'],
  ])('accentId(%s) → %s', (input, expected) => {
    expect(gallery.accentId(input)).toBe(expected);
  });
});
