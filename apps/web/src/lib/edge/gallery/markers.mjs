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

/**
 * The 503 page ("The gallery is not available right now": a D1 error, a missing shell or key). The
 * build writes it to `__gallery/503.html`; the development route handlers serve it directly.
 */
export const UNAVAILABLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not available right now</title>
<style>body{margin:0;font-family:system-ui,sans-serif;line-height:1.5}main{max-width:36rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.5rem}</style>
</head>
<body>
<main>
<h1>The gallery is not available right now</h1>
<p>Please try again in a few minutes.</p>
</main>
</body>
</html>
`;
