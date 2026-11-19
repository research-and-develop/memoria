/**
 * The import walker the bundle guards share (`relay-graph`, `edge-graph`; plan p06 D6.6). A plain
 * module, not a test file: importing a `*.test.ts` from another one would register its tests twice.
 *
 * It resolves specifiers the way wrangler's bundle does: the given `alias` map first, then relative
 * paths, `@/` → apps/web/src, `@repo/<pkg>/<path>` → packages/<pkg>/<path>. Any other specifier is a
 * third-party leaf. Type-only imports are skipped (erased). Each violation is printed with its import
 * chain from the entry.
 */
import path from 'node:path';

import { stripComments } from '@repo/core/testing/sourceIndex';

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];

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

export type Resolved = { file: string } | { external: string } | { unresolved: string };

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

export type GraphRules = {
  /** A third-party specifier the bundle must not reach (true = banned). */
  bannedPackage: (spec: string) => boolean;
  /** Why a repo file must not be reached, or null. A banned file is reported and not walked further. */
  bannedFile: (file: string) => string | null;
  /** A local specifier that resolves to nothing on purpose (a build output), not reported. */
  ignoreUnresolved?: (spec: string, from: string) => boolean;
  /** Why a specifier must not be written at all (e.g. an alias the bundle lacks), or null. Checked before resolving. */
  bannedSpecifier?: (spec: string) => string | null;
};

export type GraphWalk = { violations: string[]; reached: ReadonlySet<string> };

/** Every rule break reachable from `entry`, each with its import chain, and the files reached. Pure over `sources`. */
export function walkImports(
  entry: string,
  sources: ReadonlyMap<string, string>,
  alias: Readonly<Record<string, string>>,
  rules: GraphRules,
): GraphWalk {
  const files = new Set(sources.keys());
  const parent = new Map<string, string | null>([[entry, null]]);
  const chain = (file: string) => {
    const out: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) out.unshift(at);
    return out.join(' → ');
  };
  const violations: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    for (const spec of runtimeImports(sources.get(file) ?? '')) {
      const specReason = rules.bannedSpecifier?.(spec);
      if (specReason) violations.push(`${chain(file)} → ${spec} (${specReason})`);
      const target = resolveSpecifier(spec, file, files, alias);
      if ('external' in target) {
        if (rules.bannedPackage(target.external)) violations.push(`${chain(file)} → ${spec}`);
        continue;
      }
      if ('unresolved' in target) {
        if (rules.ignoreUnresolved?.(spec, file)) continue;
        if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('@repo/')) violations.push(`${chain(file)} → ${spec} (not found)`);
        continue;
      }
      const reason = rules.bannedFile(target.file);
      if (reason) violations.push(`${chain(file)} → ${target.file} (${reason})`);
      if (!parent.has(target.file)) {
        parent.set(target.file, file);
        if (!reason) queue.push(target.file);
      }
    }
  }
  return { violations, reached: new Set(parent.keys()) };
}
