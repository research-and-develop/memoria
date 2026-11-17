import { describe, expect, it } from 'vitest';

import { contrastRatio } from './colorContrast';
import { dark as galleryDark, light as galleryLight, SWATCHES } from './theme/gallery.mjs';
import { galleryAccent } from './theme/galleryAccent.mjs';

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
    ['inverse', 'accent-hover'],
    ['inverse', 'ink'],
    ['inverse', 'ink-hover'],
    ['inverse', 'danger'],
    ['alert', 'surface'],
    ['danger', 'surface'],
    ['danger', 'danger-wash'],
    ['live-fg', 'live-bg'],
    ['proofing-fg', 'proofing-bg'],
    ['draft-fg', 'draft-bg'],
    ['draft-fg', 'surface'],
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

/**
 * The client gallery (theme/gallery.mjs, plan p04 D4.4–D4.5): the text roles on the gallery's
 * surfaces per theme, and every accent swatch through `galleryAccent` (so a fallback change is what
 * gets tested). `inverse` is text on an accent fill only: in the dark theme `ink` is light, so the
 * `dark` button variant (bg-ink text-inverse) is not used in a gallery.
 */
describe('gallery theme contrast', () => {
  const themes = { light: galleryLight, dark: galleryDark } as const;
  const pairs = (['light', 'dark'] as const).flatMap((theme) =>
    ['surface', 'ground', 'wash'].flatMap((s) => ['ink', 'ink-2', 'ink-muted'].map((t) => [theme, t, s] as const)),
  );

  it.each(pairs)('%s: %s on %s (AA)', (theme, text, surface) => {
    expect(contrastRatio(text, surface, themes[theme])).toBeGreaterThanOrEqual(AA);
  });

  const accents = SWATCHES.flatMap((s) => (['light', 'dark'] as const).map((theme) => [s.id, theme] as const));

  it.each(accents)('%s on %s: accent 3:1, accent-ink AA on ground, wash and tint, inverse on accent and accent-hover AA', (id, theme) => {
    const colors = { ...themes[theme], ...galleryAccent(id, theme) };
    for (const surface of ['ground', 'wash']) {
      expect(contrastRatio('accent', surface, colors)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio('accent-ink', surface, colors)).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio('accent-ink', 'accent-tint', colors)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio('inverse', 'accent', colors)).toBeGreaterThanOrEqual(AA);
    // The primary button's hover (packages/ui/button.tsx: hover:bg-accent-hover).
    expect(contrastRatio('inverse', 'accent-hover', colors)).toBeGreaterThanOrEqual(AA);
  });
});
