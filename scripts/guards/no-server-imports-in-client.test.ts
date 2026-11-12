/**
 * Guard: nothing a client component imports may reach the database client,
 * the Cloudflare context or a `server-only` module.
 *
 * One VALUE import is enough: a client view model that imports a single string
 * constant from a module that reaches `@repo/db/client` drags the
 * OpenNext/Cloudflare runtime into the browser bundle. tsc is green (the types
 * are real), component tests are green (vitest runs in Node) — only a browser or
 * `next build` sees it. Share values through a dependency-free module both sides
 * import. `import type` is erased before bundling and is exempt.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCE_INDEX_ROOTS, readSourceFiles, repoRoot, stripComments } from '@repo/core/testing/sourceIndex';

const ROOT = repoRoot();
const ROOTS = ['apps/web/src', 'packages/ui'];
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const CLIENT_DIRECTIVE_RE = /^\s*['"]use client['"]\s*;?/m;

/** What a client module may not end up importing. */
const SERVER_ONLY_RE =
  /from\s+['"](?:@repo\/db\/client|@repo\/platform\/current|@repo\/platform-cloudflare(?:\/[^'"]*)?|@opennextjs\/cloudflare|wrangler)['"]|['"]server-only['"]/;

/** Value imports and re-exports; `import type` / `export type` are skipped. */
const VALUE_IMPORT_RE = /(?:^|\n)\s*import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const VALUE_EXPORT_FROM_RE = /(?:^|\n)\s*export\s+(?!type\s)(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

const sourceText = new Map(
  readSourceFiles({ roots: SOURCE_INDEX_ROOTS, extensions: CODE_EXT }).map((f) => [f.absPath, f.text]),
);

function isSourceFile(candidate: string): boolean {
  return sourceText.has(candidate) || (existsSync(candidate) && statSync(candidate).isFile());
}

/** Resolve the edges that can lead back into this repo: relative, `@/`, `@repo/*`. */
export function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.join(ROOT, 'apps/web/src', spec.slice(2));
  else if (spec.startsWith('@repo/')) {
    const [pkg = '', ...rest] = spec.slice('@repo/'.length).split('/');
    base = path.join(ROOT, 'packages', pkg, ...rest);
  } else return null;

  for (const ext of ['', ...CODE_EXT]) if (isSourceFile(base + ext)) return base + ext;
  for (const ext of CODE_EXT) if (isSourceFile(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  return null;
}

const factsCache = new Map<string, { specifiers: string[]; isServerOnly: boolean }>();

function factsOf(file: string) {
  const cached = factsCache.get(file);
  if (cached) return cached;
  const source = stripComments(sourceText.get(file) ?? readFileSync(file, 'utf8'));
  const specifiers = [...source.matchAll(VALUE_IMPORT_RE), ...source.matchAll(VALUE_EXPORT_FROM_RE)].map((m) => m[1] ?? '');
  const facts = { specifiers, isServerOnly: SERVER_ONLY_RE.test(source) };
  factsCache.set(file, facts);
  return facts;
}

/** The import chain from a client entry to a server module, or null. */
function findServerPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack = [{ file: entry, trail: [entry] }];
  while (stack.length) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const { specifiers, isServerOnly } = factsOf(file);
    if (isServerOnly) return trail;
    for (const spec of specifiers) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) stack.push({ file: resolved, trail: [...trail, resolved] });
    }
  }
  return null;
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/');

describe('client bundles never reach the server', () => {
  const clientModules = readSourceFiles({ roots: ROOTS, extensions: CODE_EXT, includeTests: false })
    .filter((f) => CLIENT_DIRECTIVE_RE.test(f.text))
    .map((f) => f.absPath);

  it('finds the client modules to check', () => {
    expect(clientModules.length).toBeGreaterThan(0);
  });

  it('no client module transitively imports the DB pool or a server-only module', () => {
    const offenders = clientModules
      .map(findServerPath)
      .filter((trail): trail is string[] => trail !== null)
      .map((trail) => trail.map(rel).join('\n     -> '));
    expect(
      offenders,
      'A client module reaches server code. Move the shared value into a dependency-free module ' +
        'both sides import, or use `import type` if only the type is needed.',
    ).toEqual([]);
  });

  it('resolves the aliases it relies on (else the walk passes for the wrong reason)', () => {
    const anchor = path.join(ROOT, 'apps/web/src/components/admin/LoginForm.tsx');
    expect(resolveSpecifier('@/lib/config/appConfig', anchor)).toBeTruthy();
    expect(resolveSpecifier('@repo/db/client', anchor)).toBeTruthy();
    expect(factsOf(path.join(ROOT, 'apps/web/src/lib/config/appConfig.ts')).isServerOnly).toBe(true);
    expect(factsOf(path.join(ROOT, 'packages/db/client.ts')).isServerOnly).toBe(true);
    expect(factsOf(path.join(ROOT, 'packages/platform/current.ts')).isServerOnly).toBe(true);
    expect(SERVER_ONLY_RE.test("import { d1Db } from '@repo/platform-cloudflare/d1';")).toBe(true);
    expect(SERVER_ONLY_RE.test("import { getPlatform } from '@repo/platform/current';")).toBe(true);
    expect(SERVER_ONLY_RE.test("import { isBlobKey } from '@repo/platform/media';")).toBe(false);
  });
});
