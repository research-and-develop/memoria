import { Cormorant_Garamond, Instrument_Serif, Space_Grotesk } from 'next/font/google';

/**
 * The client gallery's display faces (plan p04 D4.7), self-hosted by next/font. Each sets the CSS
 * variable a pairing's `--font-display` reads (packages/ui/theme/galleryFonts.mjs → FAMILIES); Inter
 * is the studio's `--font-text` (./fonts.ts). Nothing is preloaded: a browser downloads a face only
 * when text uses it, so a client loads only the gallery's pairing.
 *
 * `GALLERY_FONT_CLASSES` goes on the element that carries `data-gallery-font` (the gallery root, the
 * design page's samples, the pickers): the variables exist only where their class is.
 * A new face: one call here, one `FAMILIES` entry, one pairing (docs/recipes.md → A gallery font).
 */
const instrument = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  preload: false,
  display: 'swap',
  variable: '--font-g-instrument',
});

const cormorant = Cormorant_Garamond({
  weight: '500',
  subsets: ['latin', 'cyrillic'],
  preload: false,
  display: 'swap',
  variable: '--font-g-cormorant',
});

const space = Space_Grotesk({
  subsets: ['latin'],
  preload: false,
  display: 'swap',
  variable: '--font-g-space',
});

export const GALLERY_FONT_CLASSES = [instrument.variable, cormorant.variable, space.variable].join(' ');
