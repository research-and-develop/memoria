import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast.mjs';

describe('WCAG luminance and contrast', () => {
  it.each([
    ['#000000', 0],
    ['#FFFFFF', 1],
    ['#808080', 0.2158605],
  ])('luminance of %s', (hex, expected) => {
    expect(relativeLuminance(hex)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['#FFFFFF', '#000000', 21],
    ['#000000', '#FFFFFF', 21],
    ['#777777', '#777777', 1],
    // studio pairs already pinned in colorContrast.test.ts
    ['#16171A', '#FFFFFF', 17.92],
    ['#1F6F5C', '#FFFFFF', 6.02],
  ])('%s on %s', (a, b, ratio) => {
    expect(contrastRatio(a, b)).toBeCloseTo(ratio, 1);
  });

  it.each(['#FFF', 'white', 'rgb(0,0,0)'])('refuses %s', (bad) => {
    expect(() => relativeLuminance(bad)).toThrow();
  });
});
