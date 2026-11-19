#!/usr/bin/env node
/**
 * The second half of `build:app` (plan p06 D6.3), run after `opennextjs-cloudflare build`: copies the
 * prerendered gallery shell and 404 page into the Worker's static assets, and writes the 503 page.
 *
 *   apps/web/.next/server/app/gallery-shell.html → apps/web/.open-next/assets/__gallery/shell.html
 *   apps/web/.next/server/app/_not-found.html    → apps/web/.open-next/assets/__gallery/404.html
 *   (a static template)                          → apps/web/.open-next/assets/__gallery/503.html
 *
 * OpenNext keeps prerendered HTML in its cache, not in the assets, hence the copy. It EXITS 1 when a
 * source is missing, a marker is not found exactly once, or the shell lost its viewport tag: a Next
 * upgrade that moves or changes the prerendered HTML fails the build (CI's `build:worker`), never
 * production. `worker.ts` serves these pages (src/lib/edge/gallery/pages.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { GALLERY_MARKERS, VIEWPORT_MARK } from '../apps/web/src/lib/edge/gallery/markers.mjs';

/** "The gallery is not available right now": a D1 error, a missing shell or key (plan p06). */
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

/** @param {string} haystack @param {string} needle */
function countOf(haystack, needle) {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++;
  return count;
}

/**
 * The problems that make the shell unusable (empty when it is fine). Pure, for the tests.
 * @param {string} shell
 * @returns {string[]}
 */
export function shellProblems(shell) {
  const problems = [];
  for (const [name, marker] of Object.entries(GALLERY_MARKERS)) {
    const n = countOf(shell, marker);
    if (n !== 1) problems.push(`marker "${name}" (${marker}) found ${n} times, expected exactly once`);
  }
  if (!shell.includes(VIEWPORT_MARK)) problems.push(`no ${VIEWPORT_MARK} in the shell (the root layout's viewport)`);
  return problems;
}

/**
 * Reads the build output of the app at `appDir` and writes the three pages. Returns the problems
 * instead of throwing; nothing is written when there is one.
 * @param {string} appDir the app's directory (apps/web)
 * @returns {{ ok: true, written: string[] } | { ok: false, problems: string[] }}
 */
export function buildGalleryPages(appDir) {
  const source = path.join(appDir, '.next', 'server', 'app');
  const shellFile = path.join(source, 'gallery-shell.html');
  const notFoundFile = path.join(source, '_not-found.html');
  const problems = [];
  for (const file of [shellFile, notFoundFile]) {
    if (!existsSync(file)) problems.push(`missing ${path.relative(appDir, file)} (did the Next build prerender it?)`);
  }
  if (problems.length > 0) return { ok: false, problems };

  const shell = readFileSync(shellFile, 'utf8');
  const shellIssues = shellProblems(shell);
  if (shellIssues.length > 0) return { ok: false, problems: shellIssues };

  const outDir = path.join(appDir, '.open-next', 'assets', '__gallery');
  mkdirSync(outDir, { recursive: true });
  const pages = { 'shell.html': shell, '404.html': readFileSync(notFoundFile, 'utf8'), '503.html': UNAVAILABLE_HTML };
  const written = [];
  for (const [name, html] of Object.entries(pages)) {
    const file = path.join(outDir, name);
    writeFileSync(file, html);
    written.push(file);
  }
  return { ok: true, written };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
  const result = buildGalleryPages(appDir);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`gallery-shell: ${problem}`);
    process.exit(1);
  }
  console.log(`gallery-shell: wrote ${result.written.map((f) => path.relative(appDir, f)).join(', ')}`);
}
