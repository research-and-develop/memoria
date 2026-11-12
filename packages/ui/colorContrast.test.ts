import { describe, expect, it } from 'vitest';

import { contrastRatio } from './colorContrast';

/**
 * The text roles on the surfaces they sit on meet WCAG AA (4.5:1). Reads theme/studio.mjs, so
 * changing a colour re-checks every pair: add a row for each new text/surface combination.
 * Below AA by design (not listed): `ink-faint` (disabled and decoration only) and the field and
 * control borders (plan_202611_p00_foundation D0.7).
 */
const SURFACES = ['surface', 'ground', 'wash', 'accent-tint'];
const AA = 4.5;

describe('theme contrast (AA, 4.5:1)', () => {
  it.each(SURFACES.flatMap((s) => ['ink', 'ink-2', 'ink-muted'].map((t) => [t, s])))('%s on %s', (text, surface) => {
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(AA);
  });

  it.each([
    ['accent', 'surface'],
    ['accent', 'ground'],
    ['accent-ink', 'surface'],
    ['accent-ink', 'accent-tint'],
    ['inverse', 'accent'],
    ['inverse', 'accent-ink'],
    ['inverse', 'ink'],
    ['inverse', 'ink-hover'],
    ['inverse', 'danger'],
    ['alert', 'surface'],
    ['danger', 'surface'],
    ['danger', 'danger-wash'],
    ['live-fg', 'live-bg'],
    ['proofing-fg', 'proofing-bg'],
    ['draft-fg', 'draft-bg'],
    ['scheduled-fg', 'scheduled-bg'],
    ['expired-fg', 'expired-bg'],
  ])('%s on %s', (text, surface) => {
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(AA);
  });

  // WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on.
  it.each(['surface', 'ground', 'wash'])('the focus ring on %s (3:1)', (surface) => {
    expect(contrastRatio('focus', surface)).toBeGreaterThanOrEqual(3);
  });
});
