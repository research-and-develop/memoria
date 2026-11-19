import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GALLERY_MARKERS } from '../apps/web/src/lib/edge/gallery/markers.mjs';

import { UNAVAILABLE_HTML, buildGalleryPages, shellProblems } from './gallery-shell.mjs';

const GOOD_SHELL = [
  '<!DOCTYPE html>',
  `${GALLERY_MARKERS.html} class="f">`,
  '<head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>',
  `${GALLERY_MARKERS.head}</head><body>`,
  `${GALLERY_MARKERS.root} class="g"><main id="gallery"></main></div>`,
  `<script>self.__next_f.push([1,"{\\"data-gallery-root\\":\\"\\"}"])</script>`,
  `${GALLERY_MARKERS.bodyEnd}</html>`,
].join('');

describe('shellProblems', () => {
  it('accepts a shell with every marker once and the viewport', () => {
    expect(shellProblems(GOOD_SHELL)).toEqual([]);
  });

  it.each(Object.entries(GALLERY_MARKERS))('refuses a shell without the %s marker', (_name, marker) => {
    expect(shellProblems(GOOD_SHELL.replace(marker, ''))).toHaveLength(1);
  });

  it.each(Object.entries(GALLERY_MARKERS))('refuses a shell with the %s marker twice', (_name, marker) => {
    expect(shellProblems(`${GOOD_SHELL}${marker}`)).toHaveLength(1);
  });

  it('refuses a shell without name="viewport"', () => {
    expect(shellProblems(GOOD_SHELL.replace('name="viewport"', 'name="x"'))).toEqual([expect.stringContaining('viewport')]);
  });
});

describe('buildGalleryPages', () => {
  let appDir: string;
  const source = () => path.join(appDir, '.next', 'server', 'app');
  const out = (name: string) => path.join(appDir, '.open-next', 'assets', '__gallery', name);

  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), 'gallery-shell-'));
    mkdirSync(source(), { recursive: true });
    writeFileSync(path.join(source(), 'gallery-shell.html'), GOOD_SHELL);
    writeFileSync(path.join(source(), '_not-found.html'), '<html><title>Page not found</title></html>');
  });

  afterEach(() => rmSync(appDir, { recursive: true, force: true }));

  it('writes the shell, the 404 and the 503 pages', () => {
    const result = buildGalleryPages(appDir);
    expect(result.ok).toBe(true);
    expect(readFileSync(out('shell.html'), 'utf8')).toBe(GOOD_SHELL);
    expect(readFileSync(out('404.html'), 'utf8')).toContain('Page not found');
    expect(readFileSync(out('503.html'), 'utf8')).toBe(UNAVAILABLE_HTML);
  });

  it.each(['gallery-shell.html', '_not-found.html'])('fails without %s and writes nothing', (name) => {
    rmSync(path.join(source(), name));
    const result = buildGalleryPages(appDir);
    expect(result).toEqual({ ok: false, problems: [expect.stringContaining(name)] });
    expect(existsSync(out('shell.html'))).toBe(false);
  });

  it('fails on a shell with a missing marker and writes nothing', () => {
    writeFileSync(path.join(source(), 'gallery-shell.html'), GOOD_SHELL.replace(GALLERY_MARKERS.head, ''));
    expect(buildGalleryPages(appDir).ok).toBe(false);
    expect(existsSync(out('shell.html'))).toBe(false);
  });

  it('the 503 page is a complete static page', () => {
    expect(UNAVAILABLE_HTML).toContain('name="viewport"');
    expect(UNAVAILABLE_HTML).toContain('noindex');
    expect(UNAVAILABLE_HTML).toContain('The gallery is not available right now');
  });
});
