/**
 * The text watermark's look (plan p04 D4.9): two inks, each a fill with a contrasting shadow so the
 * text reads on any photo, and two fixed font lists. Fixed lists, never a web font or a generic
 * keyword alone, so the main-thread preview and the upload worker resolve the same face (a Web
 * Worker cannot load the page's fonts). Colours live here, the theme directory (guard
 * no-raw-colors); `apps/web/src/lib/images/watermark.ts` draws with them.
 */

export const WATERMARK_INKS = Object.freeze({
  light: Object.freeze({ fill: '#FFFFFF', shadow: 'rgba(0, 0, 0, 0.45)' }),
  dark: Object.freeze({ fill: '#16171A', shadow: 'rgba(255, 255, 255, 0.45)' }),
});

export const WATERMARK_FONTS = Object.freeze({
  sans: 'Arial, Helvetica, sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
});

/**
 * The sample photo Settings → Watermarks previews on (generated at runtime: no binary asset): a
 * dusk sky over hills, light and dark areas so both inks can be judged.
 */
export const WATERMARK_SAMPLE = Object.freeze({
  sky: Object.freeze(['#2B3A55', '#C9826B', '#F2D3A2']),
  hills: Object.freeze(['#55624A', '#3B4636', '#262D24']),
  sun: '#FBE7C6',
});
