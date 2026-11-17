/**
 * The client gallery's font pairings (plan p04 D4.7–D4.8): curated pairs of a display face (titles,
 * the welcome note) and a text face, never free mixing. A gallery stores a pairing id; an unknown id
 * reads as the default, so removing a pairing never breaks a gallery.
 *
 * Each family's CSS variable is set by a `next/font` call in `apps/web/src/app/galleryFonts.ts`
 * (`GALLERY_FONT_CLASSES`); Inter is the studio's `--font-text`. The Tailwind preset emits one rule per
 * pairing: `[data-gallery-font="<id>"] { --font-display: <stack> }` (`galleryAccent.mjs`). The variables
 * exist only where their class is, so the gallery root carries the classes AND the attribute.
 *
 * A new pairing: one `next/font` call (if the family is new) plus one entry here (docs/recipes.md →
 * A gallery font). Plain data: the preset (Node), the tests and client components read it.
 */

/**
 * The display families. `scripts` = the scripts the family covers (Cyrillic glyphs of a family
 * without it fall back to `fallback`); `galleryFonts.test.ts` checks them against the subsets
 * declared in `galleryFonts.ts`.
 */
export const FAMILIES = Object.freeze({
  instrument: { label: 'Instrument Serif', variable: '--font-g-instrument', fallback: 'Georgia, serif', scripts: ['latin'] },
  cormorant: { label: 'Cormorant Garamond', variable: '--font-g-cormorant', fallback: 'Georgia, serif', scripts: ['latin', 'cyrillic'] },
  space: { label: 'Space Grotesk', variable: '--font-g-space', fallback: 'system-ui, sans-serif', scripts: ['latin'] },
  inter: { label: 'Inter', variable: '--font-text', fallback: 'system-ui, sans-serif', scripts: ['latin', 'cyrillic'] },
});

/** @typedef {keyof typeof FAMILIES} FamilyId */
/** @typedef {{ id: string; label: string; display: FamilyId; text: FamilyId; scripts: readonly string[] }} Pairing */

/** @type {readonly Pairing[]} */
export const PAIRINGS = Object.freeze([
  { id: 'editorial', label: 'Editorial', display: 'instrument', text: 'inter', scripts: ['latin'] },
  { id: 'classic', label: 'Classic', display: 'cormorant', text: 'inter', scripts: ['latin', 'cyrillic'] },
  { id: 'modern', label: 'Modern', display: 'space', text: 'inter', scripts: ['latin'] },
  { id: 'quiet', label: 'Quiet', display: 'inter', text: 'inter', scripts: ['latin', 'cyrillic'] },
]);

/** Classic: Cormorant Garamond has Cyrillic, and titles may be Cyrillic (owner, 2026-11-17). */
export const DEFAULT_PAIRING = 'classic';

/**
 * A stored pairing id → its pairing (unknown → the default).
 * @param {unknown} id
 * @returns {Pairing}
 */
export function pairing(id) {
  return PAIRINGS.find((p) => p.id === id) ?? /** @type {Pairing} */ (PAIRINGS.find((p) => p.id === DEFAULT_PAIRING));
}

/**
 * The `--font-display` value of a pairing: its display family, then the family's fallback.
 * @param {Pairing} p
 */
export function displayStack(p) {
  const family = FAMILIES[p.display];
  return `var(${family.variable}), ${family.fallback}`;
}

/**
 * Whether a pairing's faces cover a text (only Cyrillic is told apart: the pickers warn when a sample
 * title has Cyrillic and the pairing does not, D4.8).
 * @param {Pairing} p
 * @param {string} text
 */
export function pairingCovers(p, text) {
  return !/[Ѐ-ӿ]/.test(text) || p.scripts.includes('cyrillic');
}
