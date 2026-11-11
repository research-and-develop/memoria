import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deserialize } from 'node:v8';

import { inject } from 'vitest';

import { SOURCE_INDEX_EXTENSIONS, buildSourceIndex, repoRoot, type IndexedFile } from './sourceIndexBuild';

export { repoRoot, SOURCE_INDEX_ROOTS } from './sourceIndexBuild';

/**
 * The repo's source files for a guard test, from the snapshot this run's
 * globalSetup wrote. A guard NEVER walks the tree itself: it calls this with its
 * own roots/extensions.
 */
export type SourceFile = IndexedFile & {
  /** Absolute path with OS separators. */
  absPath: string;
};

export type SourceFileQuery = {
  /** Repo-relative directories (or files), forward slashes: `['apps/web/src', 'packages/ui']`. */
  roots: readonly string[];
  /** Defaults to every code extension in the index. */
  extensions?: readonly string[];
  /** `*.test.*` / `*.spec.*` files are included unless this is false. */
  includeTests?: boolean;
};

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Per worker: a guard that queries twice loads the snapshot once.
let cached: IndexedFile[] | null = null;

function loadIndex(): IndexedFile[] {
  if (cached) return cached;
  let snapshot: string | undefined;
  try {
    snapshot = inject('sourceIndexPath');
  } catch {
    snapshot = undefined; // not inside a vitest worker
  }
  cached = snapshot ? (deserialize(readFileSync(snapshot)) as IndexedFile[]) : buildSourceIndex();
  return cached;
}

function underRoot(file: string, root: string): boolean {
  const clean = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return file === clean || file.startsWith(`${clean}/`);
}

export function readSourceFiles(query: SourceFileQuery): SourceFile[] {
  const extensions: readonly string[] = query.extensions ?? SOURCE_INDEX_EXTENSIONS;
  const root = repoRoot();
  return loadIndex()
    .filter(
      (file) =>
        query.roots.some((r) => underRoot(file.path, r)) &&
        extensions.includes(path.extname(file.path)) &&
        (query.includeTests !== false || !TEST_FILE_RE.test(file.path)),
    )
    .map((file) => ({ ...file, absPath: path.join(root, ...file.path.split('/')) }));
}

/**
 * Drop comments before matching, keeping newlines so line numbers survive. A
 * guard that scans raw text flags the documentation that names the banned
 * expression — strip first, always.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
