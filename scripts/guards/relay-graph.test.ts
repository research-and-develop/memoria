/**
 * Guard: the relay Worker (apps/relay) bundles only relay-safe code (plan p03, D3.2).
 *
 * The relay runs the app's domain code (apps/web/src/lib/**) without Next. Everything its entry
 * reaches by a runtime import must stay free of Next, React, OpenNext, the HTTP envelope
 * (`@repo/api`) and the UI (`@repo/ui`, except the plain-data theme under `@repo/ui/theme/`), and of
 * Next's composition root. One such import drags megabytes into the relay (or fails its build), and
 * nothing else would notice until a deploy.
 *
 * It resolves specifiers the way the relay's bundle does: the relay's `alias` map first (read from
 * apps/relay/wrangler.jsonc), then relative paths, `@/` → apps/web/src, `@repo/<pkg>/<path>` →
 * packages/<pkg>/<path>. Any other specifier is a third-party leaf. Type-only imports are skipped
 * (erased). A failure prints the import chain from the entry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { readSourceFiles, repoRoot, stripComments } from '@repo/core/testing/sourceIndex';

const ENTRY = 'apps/relay/src/index.ts';
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

const BANNED_PACKAGE_RE = /^(?:next|react|react-dom|@opennextjs\/[^/]+)(?:\/|$)/;
const BANNED_FILES: Record<string, string> = {
  'packages/platform/current.ts': "Next's composition root (the relay's alias points @repo/platform/current elsewhere)",
  'packages/platform-cloudflare/next.ts': 'the OpenNext wrapper',
};
function bannedFile(file: string): string | null {
  if (BANNED_FILES[file]) return BANNED_FILES[file];
  if (file.startsWith('packages/api/')) return '@repo/api (the HTTP envelope, Next routes only)';
  if (file.startsWith('packages/ui/') && !file.startsWith('packages/ui/theme/')) return '@repo/ui (React; only @repo/ui/theme/* is plain data)';
  return null;
}

const IMPORT_RES = [
  /^\s*import\s+(?!type\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, // import x from 'y' (not `import type`)
  /^\s*import\s*['"]([^'"]+)['"]/gm, // import 'y'
  /^\s*export\s+(?!type\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, // export … from 'y' (not `export type`)
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('y')
];

/** The runtime import specifiers of a source file. */
export function runtimeImports(source: string): string[] {
  const text = stripComments(source);
  return [...new Set(IMPORT_RES.flatMap((re) => [...text.matchAll(re)].map((m) => m[1] ?? '')))];
}

type Resolved = { file: string } | { external: string } | { unresolved: string };

/** Where a specifier leads, over the given files (repo-relative paths). */
export function resolveSpecifier(spec: string, from: string, files: ReadonlySet<string>, alias: Readonly<Record<string, string>>): Resolved {
  const find = (base: string): Resolved => {
    const normal = path.posix.normalize(base);
    for (const suffix of CANDIDATE_SUFFIXES) if (files.has(normal + suffix)) return { file: normal + suffix };
    return { unresolved: spec };
  };
  if (alias[spec]) return find(alias[spec]);
  if (spec.startsWith('.')) return find(path.posix.join(path.posix.dirname(from), spec));
  if (spec.startsWith('@/')) return find(`apps/web/src/${spec.slice(2)}`);
  const pkg = /^@repo\/([^/]+)(?:\/(.+))?$/.exec(spec);
  if (pkg) return find(`packages/${pkg[1]}/${pkg[2] ?? 'index'}`);
  return { external: spec };
}

/** Every rule break reachable from `entry`, each with its import chain. Pure over `sources`. */
export function relayViolations(entry: string, sources: ReadonlyMap<string, string>, alias: Readonly<Record<string, string>>): string[] {
  const files = new Set(sources.keys());
  const parent = new Map<string, string | null>([[entry, null]]);
  const chain = (file: string) => {
    const out: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) out.unshift(at);
    return out.join(' → ');
  };
  const found: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of runtimeImports(sources.get(file) ?? '')) {
      const target = resolveSpecifier(spec, file, files, alias);
      if ('external' in target) {
        if (BANNED_PACKAGE_RE.test(target.external)) found.push(`${chain(file)} → ${spec}`);
        continue;
      }
      if ('unresolved' in target) {
        if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('@repo/')) found.push(`${chain(file)} → ${spec} (not found)`);
        continue;
      }
      const reason = bannedFile(target.file);
      if (reason) found.push(`${chain(file)} → ${target.file} (${reason})`);
      if (!parent.has(target.file)) {
        parent.set(target.file, file);
        if (!reason) queue.push(target.file);
      }
    }
  }
  return found;
}

/** Repo-relative alias targets from the relay's wrangler.jsonc (its paths are relative to it). */
function relayAlias(text: string): Record<string, string> {
  const config = ts.parseConfigFileTextToJson('wrangler.jsonc', text).config as { alias?: Record<string, string> };
  return Object.fromEntries(
    Object.entries(config.alias ?? {}).map(([key, target]) => [key, path.posix.normalize(path.posix.join('apps/relay', target)).replace(/\.(ts|tsx|mjs|js)$/, '')]),
  );
}

const sources = new Map(readSourceFiles({ roots: ['apps/relay', 'apps/web/src', 'packages'] }).map((f) => [f.path, f.text]));
// wrangler.jsonc is not a code file: the source index does not hold it.
const alias = relayAlias(readFileSync(path.join(repoRoot(), 'apps/relay/wrangler.jsonc'), 'utf8'));

describe('the relay bundles only relay-safe code', () => {
  it('finds the entry and its alias map', () => {
    expect(sources.has(ENTRY)).toBe(true);
    expect(alias['@repo/platform/current']).toBe('packages/platform-cloudflare/relay');
    expect(alias['server-only']).toBe('apps/relay/src/empty');
  });

  it('reaches no Next, React, OpenNext, @repo/api or @repo/ui (except theme/)', () => {
    const found = relayViolations(ENTRY, sources, alias);
    expect(found, `The relay reaches code it must not bundle (plan p03, D3.2):\n  ${found.join('\n  ')}`).toEqual([]);
  });

  describe('its matcher', () => {
    const sample = (files: Record<string, string>) => new Map(Object.entries(files));

    it('catches a chain from @/lib to next/server, and prints it', () => {
      const files = sample({
        [ENTRY]: "import { run } from '@/lib/x';",
        'apps/web/src/lib/x.ts': "import { NextResponse } from 'next/server';\nexport const run = 1;",
      });
      expect(relayViolations(ENTRY, files, alias)).toEqual([`${ENTRY} → apps/web/src/lib/x.ts → next/server`]);
    });

    it('skips type-only imports, sees re-exports and dynamic imports', () => {
      expect(runtimeImports("import type { A } from 'next/server';\nexport type { B } from 'react';")).toEqual([]);
      expect(runtimeImports("export { x } from './x';\nconst m = await import('react');\nimport 'server-only';").sort()).toEqual(['./x', 'react', 'server-only']);
      expect(runtimeImports("import {\n  a,\n  type B,\n} from './multi';")).toEqual(['./multi']);
    });

    it('@repo/db/client passes with the alias map and fails without it', () => {
      expect(relayViolations('packages/db/client.ts', sources, alias)).toEqual([]);
      const without = relayViolations('packages/db/client.ts', sources, {});
      expect(without.some((v) => v.includes('packages/platform/current.ts'))).toBe(true);
    });

    it('@repo/ui/theme passes, the rest of @repo/ui does not', () => {
      const files = sample({
        [ENTRY]: "import { studio } from '@repo/ui/theme/studio.mjs';\nimport { Button } from '@repo/ui/button';",
        'packages/ui/theme/studio.mjs': 'export const studio = {};',
        'packages/ui/button.tsx': "import * as React from 'react';",
      });
      expect(relayViolations(ENTRY, files, alias)).toEqual([`${ENTRY} → packages/ui/button.tsx (@repo/ui (React; only @repo/ui/theme/* is plain data))`]);
    });

    it('an import that resolves nowhere is reported', () => {
      expect(relayViolations(ENTRY, sample({ [ENTRY]: "import { x } from '@/lib/missing';" }), alias)).toEqual([`${ENTRY} → @/lib/missing (not found)`]);
    });
  });
});
