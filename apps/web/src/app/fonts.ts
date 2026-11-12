import { Inter, JetBrains_Mono } from 'next/font/google';

/**
 * The studio fonts, self-hosted by next/font (downloaded at build, served from /_next/static).
 * Each sets the CSS variable the theme's font stacks read (packages/ui/theme/studio.mjs →
 * fontFamily); globals.css holds the system fallbacks. Imported only by the root layout, which puts
 * both `variable` classes on <html>. To change a font, change it here: nothing else names one.
 *
 * `subsets` decides only what is PRELOADED. Other scripts (Cyrillic) still render in Inter through
 * its `unicode-range` faces; the design page shows a Cyrillic line to confirm.
 */
export const textFont = Inter({
  subsets: ['latin'],
  // Variable font: every weight, 650 (`font-title`) included.
  weight: 'variable',
  display: 'swap',
  variable: '--font-text',
});

export const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-mono',
  // Rare (filenames, codes): not worth a preload on every page.
  preload: false,
});
