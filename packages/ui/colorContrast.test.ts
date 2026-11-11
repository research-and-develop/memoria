import { describe, expect, it } from 'vitest';

import { contrastRatio } from './colorContrast';

/**
 * The text tokens on the surfaces they sit on meet WCAG AA (4.5:1). Reads the
 * preset, so changing a colour re-checks every pair: add a row for each new
 * text/surface combination the design uses.
 */
const SURFACES = ['white', 'page', 'brand-wash', 'brand-tint', 'accent-wash'];

describe('token contrast (AA, 4.5:1)', () => {
  it.each(SURFACES)('ink on %s', (surface) => {
    expect(contrastRatio('ink', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)('ink-muted on %s', (surface) => {
    expect(contrastRatio('ink-muted', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['white', 'brand-wash', 'accent-wash'])('brand-strong on %s', (surface) => {
    expect(contrastRatio('brand-strong', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['brand-strong', 'danger'])('white text on %s (filled buttons)', (surface) => {
    expect(contrastRatio('white', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('brand-deep on brand-subtle (chips)', () => {
    expect(contrastRatio('brand-deep', 'brand-subtle')).toBeGreaterThanOrEqual(4.5);
  });
});
