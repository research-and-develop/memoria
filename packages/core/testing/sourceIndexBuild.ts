import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The one walk of the source tree that every guard test shares.
 *
 * Built once per vitest run by `./sourceIndexSetup` and read through
 * `./sourceIndex`. On Windows the per-file open dominates (~1 s per few
 * thousand files); a dozen guards each re-reading the tree is what pushes them
 * past the test timeout under a full run. Test-only; Node built-ins only.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where `./sourceIndexSetup` wrote this run's source snapshot. */
    sourceIndexPath: string;
  }
}

/** Every root a guard may scan. A guard narrows this with `roots`. Add each new app by name, never `apps/*`. */
export const SOURCE_INDEX_ROOTS = ['apps/web', 'packages', 'scripts'] as const;

/** Never source: dependencies, build output (Next, OpenNext, wrangler state), VCS and scratch space. */
const SKIP_DIRS = new Set(['node_modules', '.next', '.open-next', '.wrangler', '.git', 'dist', 'coverage', 'tmp']);

/** Generated declaration files (`next dev`, `npm run cf-typegen`): committed, but not source a guard should judge. */
const GENERATED_FILES = new Set(['next-env.d.ts', 'cloudflare-env.d.ts']);

export const SOURCE_INDEX_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

export type IndexedFile = {
  /** Repo-relative, forward slashes: `apps/web/src/app/page.tsx`. */
  path: string;
  text: string;
};

/** The repository root, resolved from this file's location. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a root that does not exist in this checkout
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || GENERATED_FILES.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if ((SOURCE_INDEX_EXTENSIONS as readonly string[]).includes(path.extname(entry.name))) out.push(full);
  }
}

/** Walk every root and read every code file, sorted by path. */
export function buildSourceIndex(root: string = repoRoot()): IndexedFile[] {
  const files: string[] = [];
  for (const sourceRoot of SOURCE_INDEX_ROOTS) walk(path.join(root, sourceRoot), files);
  return files
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort()
    .map((file) => ({ path: file, text: readFileSync(path.join(root, ...file.split('/')), 'utf8') }));
}
