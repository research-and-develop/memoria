/**
 * The gallery shell's injection markers and asset paths (plan p06 D6.3, D6.4). Plain `.mjs` with no
 * imports, shared by the build step (scripts/gallery-shell.mjs, run by node) and the edge code
 * (`worker.ts` and `src/lib/edge/**`). Each marker must occur EXACTLY ONCE in the prerendered shell:
 * the build fails otherwise, so a Next upgrade that changes the markup fails the build, not production.
 *
 * - `html`: the root layout's `<html lang="en"` (the injection sets `lang` and `data-gallery-theme`);
 * - `root`: the gallery wrapper in app/gallery-shell/layout.tsx (theme, accent and font attributes);
 * - `head`: the metadata of app/gallery-shell/page.tsx (→ <title>, description, Open Graph tags);
 * - `bodyEnd`: the view JSON goes just before it, outside React's tree.
 */
export const GALLERY_MARKERS = Object.freeze({
  html: '<html lang="en"',
  root: '<div data-gallery-root=""',
  head: '<meta name="memoria-gallery-head" content="1"/>',
  bodyEnd: '</body>',
});

/** Phones need it (D6.2): the build checks the shell keeps the root layout's viewport. */
export const VIEWPORT_MARK = 'name="viewport"';

/**
 * The three pages under `.open-next/assets/__gallery/`, fetched through the ASSETS binding WITHOUT
 * the `.html` extension (the default `auto-trailing-slash` answers `/x.html` with a 307 to `/x`).
 * Publicly reachable too: they hold no data.
 */
export const GALLERY_PAGES = Object.freeze({
  shell: '/__gallery/shell',
  notFound: '/__gallery/404',
  unavailable: '/__gallery/503',
});
