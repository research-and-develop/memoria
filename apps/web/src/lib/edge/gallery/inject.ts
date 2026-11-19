import { GALLERY_MARKERS } from './markers.mjs';
import type { GalleryView } from './view';

/**
 * Puts a gallery into the static shell (plan p06 D6.4), by markers, not `HTMLRewriter`, so it runs in
 * workerd AND in Node (the development routes, vitest). Pure. Each marker must occur exactly once (the
 * build checks it too, scripts/gallery-shell.mjs); a missing one throws.
 *
 * - `<html lang="en"` → the studio's language and `data-gallery-theme` (the page background and
 *   `color-scheme` match the gallery);
 * - the `data-gallery-root` wrapper → `data-gallery-theme`, `-accent`, `-font` (the font classes are on
 *   that element);
 * - the head marker → `<title>`, the description and the Open Graph tags (`og:image` only when given:
 *   link-access galleries, D6.14);
 * - just before `</body>`, OUTSIDE React's tree → `<script id="__gallery" type="application/json">`.
 * Every attribute value and text goes through ONE escaper (`escapeHtml`); the JSON has every `<` and
 * U+2028/U+2029 written as `\uXXXX` escapes, so no value can close the script or a tag.
 */
export const VIEW_SCRIPT_ID = '__gallery';
const DESCRIPTION_MAX = 200;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** For attribute values and element text alike. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const unicodeEscape = (code: number) => `\\u${code.toString(16).padStart(4, '0')}`;

/** JSON safe inside a `<script>` element: no `<` (so no `</script>` or `<!--`), no line/paragraph separators. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, unicodeEscape(0x3c))
    .split(LINE_SEPARATOR)
    .join(unicodeEscape(0x2028))
    .split(PARAGRAPH_SEPARATOR)
    .join(unicodeEscape(0x2029));
}

function replaceOnce(html: string, marker: string, replacement: string): string {
  const at = html.indexOf(marker);
  if (at === -1 || html.indexOf(marker, at + marker.length) !== -1) throw new Error(`gallery shell: marker ${JSON.stringify(marker)} not found exactly once`);
  return html.slice(0, at) + replacement + html.slice(at + marker.length);
}

const attr = (name: string, value: string) => ` ${name}="${escapeHtml(value)}"`;
const meta = (key: 'name' | 'property', name: string, content: string) => `<meta ${key}="${name}" content="${escapeHtml(content)}"/>`;

function truncate(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** `lang` from a locale (`en-GB` → `en-GB`); anything odd → `en`. */
function langOf(locale: string): string {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : 'en';
}

export function injectGallery(shell: string, view: GalleryView, opts: { ogImage: string | null }): string {
  const { gallery, studio } = view;
  const welcome = view.kind === 'gallery' ? view.gallery.welcome : '';
  const description = truncate(welcome, DESCRIPTION_MAX) || truncate(studio.name, DESCRIPTION_MAX);
  const head = [
    `<title>${escapeHtml(gallery.title)}</title>`,
    meta('name', 'description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', gallery.title),
    meta('property', 'og:description', studio.name),
    ...(opts.ogImage ? [meta('property', 'og:image', opts.ogImage)] : []),
  ].join('');

  let html = shell;
  html = replaceOnce(html, GALLERY_MARKERS.html, `<html${attr('lang', langOf(studio.locale))}${attr('data-gallery-theme', gallery.theme)}`);
  html = replaceOnce(
    html,
    GALLERY_MARKERS.root,
    `${GALLERY_MARKERS.root}${attr('data-gallery-theme', gallery.theme)}${attr('data-gallery-accent', gallery.accent)}${attr('data-gallery-font', gallery.font)}`,
  );
  html = replaceOnce(html, GALLERY_MARKERS.head, head);
  html = replaceOnce(html, GALLERY_MARKERS.bodyEnd, `<script id="${VIEW_SCRIPT_ID}" type="application/json">${jsonForScript(view)}</script>${GALLERY_MARKERS.bodyEnd}`);
  return html;
}
