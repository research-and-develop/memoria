import { contrastRatio } from './contrast.mjs';
import { themeCssVars } from './cssVars.mjs';
import { ROLE_MAPS, SWATCHES, dark, light } from './gallery.mjs';
import { PAIRINGS, displayStack } from './galleryFonts.mjs';

/**
 * The gallery accents and the CSS rules of every gallery theme (plan p04 D4.4–D4.7).
 *
 * A swatch becomes the accent roles of a theme by mixing it towards white (dark themes) or black
 * (light themes) in sRGB channel space, 5 % at a time, until it is legible:
 * - `accent` (fills, rings, the heart: UI contrast) ≥ 3.2:1 against `ground` and `wash`;
 * - `accent-ink` (any accent-coloured text, links; also `focus`) ≥ 4.5:1 against both and against
 *   `accent-tint` (accent text on a tint: pills, selected rows);
 * - `inverse` (text on an accent fill) = `contrastText(accent)`; when nothing reaches 4.5:1, the
 *   accent keeps mixing until something does;
 * - `accent-hover` (the primary button's hover fill) = the accent mixed 12 % away from `inverse`
 *   (towards black under white text), so the hover is visible and its text only gains contrast.
 *   Not `accent-ink`: on dark themes that is lighter than the accent, under white text.
 * A swatch that passes is used as it is. Gallery text never uses `accent`, only `accent-ink`.
 *
 * Plain JS: the Tailwind preset (Node) emits `galleryThemeRules()`; the tests check every swatch.
 */

/** @typedef {'light' | 'dark'} GalleryTheme */
/** @typedef {{ accent: { DEFAULT: string; ink: string; tint: string; hover: string }; focus: string; inverse: string }} AccentRoles */
/** @typedef {{ selector: string; media?: string; vars: Record<string, string> }} GalleryRule */

/** UI contrast for the accent fill: WCAG 1.4.11 asks 3:1; 3.2 leaves room for rounding (D4.5). */
export const ACCENT_MIN = 3.2;
/** Text contrast (WCAG AA). */
export const TEXT_MIN = 4.5;

const WHITE = '#FFFFFF';
const BLACK = '#000000';
/** The studio's near-black, preferred over pure black for text on an accent. */
const NEAR_BLACK = '#16171A';

/**
 * `c + (target − c) · t` per channel, rounded.
 * @param {string} hex `#RRGGBB`
 * @param {string} target `#RRGGBB`
 * @param {number} t 0 … 1
 */
export function mix(hex, target, t) {
  const channel = (/** @type {string} */ h, /** @type {number} */ i) => Number.parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(hex, i) + (channel(target, i) - channel(hex, i)) * t))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/**
 * Text on a fill: white or the near-black, whichever contrasts more; if neither reaches 4.5:1, pure
 * white or black, whichever contrasts more; null when even that is below 4.5:1.
 * @param {string} fill `#RRGGBB`
 * @returns {string | null}
 */
export function contrastText(fill) {
  for (const [a, b] of [
    [WHITE, NEAR_BLACK],
    [WHITE, BLACK],
  ]) {
    const best = contrastRatio(/** @type {string} */ (a), fill) >= contrastRatio(/** @type {string} */ (b), fill) ? a : b;
    if (contrastRatio(/** @type {string} */ (best), fill) >= TEXT_MIN) return /** @type {string} */ (best);
  }
  return null;
}

/** How far the primary hover moves from the accent, away from its text colour. */
export const HOVER_MIX = 0.12;

/** The mixing steps: t = 0, 0.05, … 1. */
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * @param {string} id a swatch id
 * @returns {string} its hex
 */
function swatchHex(id) {
  const swatch = SWATCHES.find((s) => s.id === id);
  if (!swatch) throw new Error(`unknown gallery accent ${id}`);
  return swatch.hex;
}

/**
 * The accent roles of a swatch in a theme.
 * @param {string} swatchId
 * @param {GalleryTheme} theme
 * @returns {AccentRoles}
 */
export function galleryAccent(swatchId, theme) {
  const hex = swatchHex(swatchId);
  const { ground, wash } = theme === 'dark' ? dark : light;
  const target = theme === 'dark' ? WHITE : BLACK;
  const tint = mix(ground, hex, 0.12);
  const legible = (/** @type {string} */ c, /** @type {number} */ min, /** @type {string[]} */ on = [ground, wash]) =>
    on.every((surface) => contrastRatio(c, surface) >= min);
  // Mixing towards the theme's far end only increases contrast with the ground and the wash, so the
  // accent found first stays legible while it keeps mixing for its text colour.
  let accent = null;
  let inverse = null;
  for (const t of STEPS) {
    const candidate = mix(hex, target, t);
    if (!legible(candidate, ACCENT_MIN)) continue;
    inverse = contrastText(candidate);
    if (inverse) {
      accent = candidate;
      break;
    }
  }
  const ink = STEPS.map((t) => mix(hex, target, t)).find((c) => legible(c, TEXT_MIN, [ground, wash, tint]));
  if (!accent || !inverse || !ink) throw new Error(`no legible accent for ${swatchId} on ${theme}`);
  const hover = mix(accent, inverse === WHITE ? BLACK : WHITE, HOVER_MIX);
  return { accent: { DEFAULT: accent, ink, tint, hover }, focus: ink, inverse };
}

/** @param {Record<string, string>} vars @param {string} scheme */
const withScheme = (vars, scheme) => ({ ...vars, 'color-scheme': scheme });

/** A role map is dark when its ground is darker than mid-grey. @param {{ ground: string }} map */
const schemeOf = (map) => (contrastRatio(map.ground, BLACK) < contrastRatio(map.ground, WHITE) ? 'dark' : 'light');

const DARK_MEDIA = '(prefers-color-scheme: dark)';

/**
 * Every gallery CSS rule, in cascade order: one rule set per role map in `ROLE_MAPS` (with its
 * `color-scheme`), `auto` (light, then dark inside the media query), one rule per swatch × theme
 * (the light one also serves auto; the auto-dark one inside the media query), one rule per font
 * pairing (`--font-display`). The preset adds them after the studio's `:root` rule, so a gallery scope wins.
 * @returns {GalleryRule[]}
 */
export function galleryThemeRules() {
  /** @type {GalleryRule[]} */
  const rules = Object.entries(ROLE_MAPS).map(([name, map]) => ({
    selector: `[data-gallery-theme="${name}"]`,
    vars: withScheme(themeCssVars(map), schemeOf(map)),
  }));
  rules.push(
    { selector: '[data-gallery-theme="auto"]', vars: withScheme(themeCssVars(light), 'light') },
    { selector: '[data-gallery-theme="auto"]', media: DARK_MEDIA, vars: withScheme(themeCssVars(dark), 'dark') },
  );
  for (const { id } of SWATCHES) {
    const accent = `[data-gallery-accent="${id}"]`;
    rules.push(
      { selector: `[data-gallery-theme="light"]${accent}, [data-gallery-theme="auto"]${accent}`, vars: themeCssVars(galleryAccent(id, 'light')) },
      { selector: `[data-gallery-theme="dark"]${accent}`, vars: themeCssVars(galleryAccent(id, 'dark')) },
      { selector: `[data-gallery-theme="auto"]${accent}`, media: DARK_MEDIA, vars: themeCssVars(galleryAccent(id, 'dark')) },
    );
  }
  for (const p of PAIRINGS) rules.push({ selector: `[data-gallery-font="${p.id}"]`, vars: { '--font-display': displayStack(p) } });
  return rules;
}

/**
 * The rules as a CSS-in-JS object for Tailwind's `addBase` (insertion order is cascade order).
 * @param {GalleryRule[]} rules
 */
export function rulesToCssInJs(rules) {
  return rules.map((rule) => (rule.media ? { [`@media ${rule.media}`]: { [rule.selector]: rule.vars } } : { [rule.selector]: rule.vars }));
}
