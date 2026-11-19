import { describe, expect, it } from 'vitest';

import { VIEW_SCRIPT_ID, escapeHtml, injectGallery, jsonForScript } from './inject';
import { GALLERY_MARKERS } from './markers.mjs';
import type { GalleryGateView, GalleryPageView } from './view';

const SHELL = [
  '<!DOCTYPE html>',
  `${GALLERY_MARKERS.html} class="fonts">`,
  `<head><meta charSet="utf-8"/>${GALLERY_MARKERS.head}</head>`,
  `<body class="b"><div hidden=""></div>${GALLERY_MARKERS.root} class="g"><main id="gallery" aria-busy="true"></main></div>`,
  '<script>self.__next_f.push([1,"x"])</script>',
  `${GALLERY_MARKERS.bodyEnd}</html>`,
].join('');

const LS = String.fromCharCode(0x2028);
const NASTY = `"Quotes" & 'apostrophes' --> </script><b>Сватба</b>${LS}`;

const studio = { name: NASTY, website: null, locale: 'en-GB', timeZone: 'UTC' };

function pageView(over: Partial<GalleryPageView['gallery']> = {}): GalleryPageView {
  return {
    v: 1,
    kind: 'gallery',
    gallery: {
      id: '9a11e700-0000-4000-8000-000000000001',
      slug: 'maria-jonas-k7x2qpm4rt',
      title: NASTY,
      date: '2026-10-03',
      purpose: 'selection',
      welcome: NASTY,
      cover: null,
      theme: 'dark',
      accent: 'pine',
      font: 'classic',
      grid: 'masonry',
      sort: 'filename',
      protect: true,
      ...over,
    },
    studio,
    media: 'https://media.example.test',
    sets: [],
    page: null,
  };
}

const gateView: GalleryGateView = {
  v: 1,
  kind: 'gate',
  gallery: { slug: 'x-y-z', title: NASTY, theme: 'light', accent: 'pine', font: 'modern' },
  studio,
  turnstileSiteKey: 'site-key',
};

/** The view JSON as the browser reads it back from the script element. */
function scriptJson(html: string): unknown {
  const open = `<script id="${VIEW_SCRIPT_ID}" type="application/json">`;
  const start = html.indexOf(open) + open.length;
  return JSON.parse(html.slice(start, html.indexOf('</script>', start)));
}

describe('injectGallery', () => {
  it('sets lang and the theme on <html>, and the look on the wrapper', () => {
    const html = injectGallery(SHELL, pageView(), { ogImage: null });
    expect(html).toContain('<html lang="en-GB" data-gallery-theme="dark" class="fonts">');
    expect(html).toContain(`${GALLERY_MARKERS.root} data-gallery-theme="dark" data-gallery-accent="pine" data-gallery-font="classic" class="g">`);
  });

  it('puts the JSON just before </body>, outside the React root', () => {
    const html = injectGallery(SHELL, pageView(), { ogImage: null });
    expect(html).toMatch(new RegExp(`<script>self\\.__next_f[^<]*</script><script id="${VIEW_SCRIPT_ID}" type="application/json">[^<]*</script></body></html>$`));
    expect(scriptJson(html)).toEqual(pageView());
  });

  it.each([
    ['a gallery', pageView()],
    ['a gate', gateView],
  ])('escapes quotes, -->, </script>, & and keeps Cyrillic in every marker (%s)', (_label, view) => {
    const html = injectGallery(SHELL, view, { ogImage: null });
    // One </script> per script element: the shell's and ours.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    // Outside the JSON every `>` is escaped; inside it no `<` survives, so no `<!--` can open a comment.
    const json = html.slice(html.indexOf(`<script id="${VIEW_SCRIPT_ID}"`));
    expect(html.slice(0, html.length - json.length)).not.toContain('-->');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('<b>');
    expect(json).not.toContain(LS);
    expect(html).toContain(`<title>${escapeHtml(NASTY)}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${escapeHtml(NASTY)}"/>`);
    expect(html).toContain(`<meta property="og:description" content="${escapeHtml(NASTY)}"/>`);
    expect(html).toContain('Сватба');
    expect(scriptJson(html)).toEqual(view);
  });

  it('describes the gallery by its welcome note, else the studio name', () => {
    const long = injectGallery(SHELL, pageView({ welcome: `${'word '.repeat(80)}end` }), { ogImage: null });
    expect(long).toMatch(/<meta name="description" content="(word ){39}word…"\/>/);
    const empty = injectGallery(SHELL, pageView({ welcome: '' }), { ogImage: null });
    expect(empty).toContain(`<meta name="description" content="${escapeHtml(NASTY.replace(/\s+/g, ' ').trim())}"/>`);
  });

  it('adds og:image only when given', () => {
    expect(injectGallery(SHELL, pageView(), { ogImage: null })).not.toContain('og:image');
    expect(injectGallery(SHELL, pageView(), { ogImage: 'https://media.example.test/a"b' })).toContain(
      '<meta property="og:image" content="https://media.example.test/a&quot;b"/>',
    );
  });

  it.each(Object.entries(GALLERY_MARKERS))('throws when the %s marker is missing', (_name, marker) => {
    expect(() => injectGallery(SHELL.replace(marker, ''), pageView(), { ogImage: null })).toThrow(/not found exactly once/);
  });

  it('throws when a marker is doubled', () => {
    expect(() => injectGallery(`${SHELL}${GALLERY_MARKERS.head}`, pageView(), { ogImage: null })).toThrow(/not found exactly once/);
  });

  it('falls back to lang="en" for an odd locale', () => {
    const view = { ...pageView(), studio: { ...studio, locale: '"><x' } };
    expect(injectGallery(SHELL, view, { ogImage: null })).toContain('<html lang="en" ');
  });
});

describe('jsonForScript', () => {
  it('writes < and the line/paragraph separators as escapes and round-trips', () => {
    const value = { a: `</script><!--${LS}${String.fromCharCode(0x2029)}` };
    const json = jsonForScript(value);
    expect(json).not.toContain('<');
    expect(json).not.toContain(LS);
    expect(json).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(json)).toEqual(value);
  });
});
