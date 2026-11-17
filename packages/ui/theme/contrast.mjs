/**
 * WCAG 2.x relative luminance and contrast ratio of `#RRGGBB` colours. Plain JS, no imports: the
 * gallery accents (`galleryAccent.mjs`) compute their fallbacks with it in the Tailwind preset (Node),
 * and `colorContrast.ts` pins the theme's text/surface pairs with it in the tests.
 */

/**
 * @param {string} hex `#RRGGBB`
 * @returns {number} 0 (black) … 1 (white)
 */
export function relativeLuminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`colours are #RRGGBB, got ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * /** @type {number} */ (r) + 0.7152 * /** @type {number} */ (g) + 0.0722 * /** @type {number} */ (b);
}

/**
 * The contrast ratio of two colours, 1 … 21 (order does not matter).
 * @param {string} a `#RRGGBB`
 * @param {string} b `#RRGGBB`
 */
export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (/** @type {number} */ (hi) + 0.05) / (/** @type {number} */ (lo) + 0.05);
}
