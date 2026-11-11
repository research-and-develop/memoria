import preset from './tailwind-preset.mjs';

/**
 * WCAG contrast of the design tokens, for tests that pin a text/background pair
 * to AA (4.5:1). Reads the preset, so a token change re-checks every pair.
 */
type Palette = Record<string, string | Record<string, string>>;
const colors = (preset as { theme: { extend: { colors: Palette } } }).theme.extend.colors;

/** A token as Tailwind names it (`brand-strong`, `ink`, `white`) → its hex value. */
export function tokenHex(token: string): string {
  if (token === 'white') return '#FFFFFF';
  const [group, shade] = token.split('-') as [string, string | undefined];
  const value = colors[group];
  const resolved = typeof value === 'string' ? value : value?.[shade ?? 'DEFAULT'];
  if (!resolved) throw new Error(`unknown colour token ${token}`);
  return resolved;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two tokens (or hex colours). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [a, b].map((c) => (c.startsWith('#') ? c : tokenHex(c)));
  const [hi, lo] = [luminance(x!), luminance(y!)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
