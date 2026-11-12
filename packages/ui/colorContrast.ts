import { flattenColors, type ColorRoles } from './theme/cssVars.mjs';
import studio from './theme/studio.mjs';

/**
 * WCAG contrast of a theme's colour roles, for tests that pin a text/background pair to AA (4.5:1).
 * Reads the theme, so a colour change re-checks every pair. Defaults to the studio theme; pass
 * another theme's colours to check it the same way.
 */

/** A role as Tailwind names it (`accent-ink`, `ink`, `live-fg`) → its hex value. */
export function tokenHex(token: string, colors: ColorRoles = studio.colors): string {
  const resolved = new Map(flattenColors(colors)).get(token);
  if (!resolved) throw new Error(`unknown colour token ${token}`);
  return resolved;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two roles (or hex colours). */
export function contrastRatio(a: string, b: string, colors: ColorRoles = studio.colors): number {
  const [x, y] = [a, b].map((c) => (c.startsWith('#') ? c : tokenHex(c, colors)));
  const [hi, lo] = [luminance(x!), luminance(y!)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
