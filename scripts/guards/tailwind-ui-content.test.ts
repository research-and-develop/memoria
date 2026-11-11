/**
 * Guard: every app's Tailwind config scans `packages/ui`, and scans no tests.
 *
 * Tailwind v3 does not merge `content` across presets, so an app that extends
 * the preset but forgets to spread `uiContentGlobs` builds green and renders
 * every primitive unstyled. The mirror rule: a config must not reach
 * `*.test.ts(x)` — mock data reads as class names, and a deleted test file
 * breaks the incremental scan until `.next` is cleared.
 *
 * Expands the globs for real rather than pattern-matching the strings: only
 * running the scan answers whether it reaches the file.
 */
import { existsSync, globSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '@repo/core/testing/sourceIndex';

const ROOT = repoRoot();
/** Add each new app's config here. */
const TAILWIND_CONFIGS = ['apps/web/tailwind.config.mjs'];
/** A file in packages/ui; if a config's globs miss it, that config is not scanning the package. */
const CANARY = 'packages/ui/typography.tsx';

const toPosix = (value: string) => value.split(path.sep).join('/');

async function contentGlobs(configPath: string): Promise<string[]> {
  const resolveConfig = (await import('tailwindcss/resolveConfig')).default;
  const url = new URL(`file://${toPosix(path.resolve(ROOT, configPath))}`);
  const config = (await import(url.href)).default;
  return (resolveConfig(config) as unknown as { content: { files: string[] } }).content.files;
}

function scan(globs: string[], cwd: string) {
  const positives = globs.filter((g) => !g.startsWith('!'));
  const ignores = globs.filter((g) => g.startsWith('!')).map((g) => toPosix(path.resolve(cwd, g.slice(1))));
  const reached = new Set<string>();
  for (const glob of positives) for (const hit of globSync(glob, { cwd })) reached.add(toPosix(path.resolve(cwd, hit)));
  return [...reached].filter((file) => !ignores.some((ignore) => path.posix.matchesGlob(file, ignore)));
}

describe('tailwind configs', () => {
  for (const configPath of TAILWIND_CONFIGS) {
    // Relative globs are anchored at the build CWD: the app's own directory.
    const cwd = path.resolve(ROOT, path.dirname(configPath));

    it(`${configPath} exists`, () => {
      expect(existsSync(path.resolve(ROOT, configPath))).toBe(true);
    });

    it(`${configPath} covers ${CANARY}`, async () => {
      const reached = scan(await contentGlobs(configPath), cwd);
      expect(reached).toContain(toPosix(path.resolve(ROOT, CANARY)));
    });

    it(`${configPath} reaches no *.test.ts(x)`, async () => {
      const reached = scan(await contentGlobs(configPath), cwd);
      expect(reached.filter((f) => /\.test\.tsx?$/.test(f)).slice(0, 5)).toEqual([]);
    });
  }
});
