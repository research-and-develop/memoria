import { contrastRatio as hexContrast } from './theme/contrast.mjs';
import type { ColorRoles } from './theme/cssVars.mjs';
import studio from './theme/studio.mjs';
import { tokenHex } from './theme/tokens.mjs';

/**
 * WCAG contrast of a theme's colour roles, for tests that pin a text/background pair to AA (4.5:1).
 * Reads the theme, so a colour change re-checks every pair. Defaults to the studio theme; pass
 * another theme's colours to check it the same way. The maths lives in `theme/contrast.mjs`.
 */

export { tokenHex };

/** The contrast ratio of two roles (or hex colours). */
export function contrastRatio(a: string, b: string, colors: ColorRoles = studio.colors): number {
  const [x, y] = [a, b].map((c) => (c.startsWith('#') ? c : tokenHex(c, colors)));
  return hexContrast(x!, y!);
}
