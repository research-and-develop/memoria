/**
 * Guard: domain code never touches Cloudflare. It talks to the ports of
 * `@repo/platform` through `getPlatform()` (`@repo/platform/current`), so a
 * Docker deployment can later be new adapters instead of a rewrite.
 *
 * Outside the allowed files below, nothing may:
 *   - import (`from`, `import()`, `require()`, `vi.mock()`) `@opennextjs/cloudflare`,
 *     `wrangler`, `@repo/platform-cloudflare` (any subpath) or a `cloudflare:` module;
 *   - call `getCloudflareContext(`;
 *   - name a Cloudflare runtime type (`D1Database`, `R2Bucket`, `ExecutionContext`, …).
 *     The generated Workers types are global, so `tsc` cannot enforce this; this guard does.
 * And the contract suites (`@repo/platform/contract/*`) are imported only by `*.test.ts` files.
 *
 * Matches module specifiers and identifiers on comment-stripped source, so a
 * string such as "npx wrangler secret put" is fine.
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ROOTS = ['apps/web/src', 'apps/web/scripts', 'packages', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs'];
const SENTINEL = 'apps/web/src/lib/auth/requireAdmin.ts';

/** Where Cloudflare may appear: the adapters, the composition root, the test harness, the Worker's own files. */
const ALLOWED = [
  /^packages\/platform-cloudflare\//,
  /^packages\/platform\/current\.ts$/,
  /^packages\/db\/test-utils\.ts$/,
  /^apps\/web\/worker\.ts$/,
  /^apps\/web\/next\.config\.mjs$/,
  /^apps\/web\/open-next\.config\.ts$/,
  // Their samples and regexes name the banned things.
  /^scripts\/guards\/platform-boundary\.test\.ts$/,
  /^scripts\/guards\/wrangler-config\.test\.ts$/,
  /^scripts\/guards\/no-server-imports-in-client\.test\.ts$/,
];

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bvi\s*\.\s*(?:mock|doMock)\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
const CLOUDFLARE_MODULE_RE = /^(?:@opennextjs\/cloudflare|wrangler|@repo\/platform-cloudflare)(?:\/|$)|^cloudflare:/;
const CONTRACT_MODULE_RE = /^@repo\/platform\/contract\//;
const CONTEXT_CALL_RE = /\bgetCloudflareContext\s*\(/;
const RUNTIME_TYPE_RE =
  /\b(D1Database|D1PreparedStatement|D1Result|D1Meta|R2Bucket|R2Object|ExecutionContext|CloudflareEnv|KVNamespace|FixedLengthStream)\b/g;
const TEST_FILE_RE = /\.test\.tsx?$/;

/** The rule breaks in one file (pure: the self-test drives it with samples). */
export function violations(file: string, source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];
  for (const m of text.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? '';
    if (CLOUDFLARE_MODULE_RE.test(spec)) found.push(`imports ${spec}`);
    if (CONTRACT_MODULE_RE.test(spec) && !TEST_FILE_RE.test(file)) found.push(`imports ${spec} outside a test`);
  }
  if (CONTEXT_CALL_RE.test(text)) found.push('calls getCloudflareContext()');
  const types = new Set([...text.matchAll(RUNTIME_TYPE_RE)].map((m) => m[1]));
  for (const type of types) found.push(`names ${type}`);
  return found;
}

const files = readSourceFiles({ roots: ROOTS, extensions: EXTENSIONS });

describe('domain code never touches Cloudflare (platform boundary)', () => {
  it('scans the source tree, the sentinel included', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.path)).toContain(SENTINEL);
  });

  it('finds no Cloudflare outside the adapters', () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((re) => re.test(f.path)))
      .flatMap((f) => violations(f.path, f.text).map((v) => `${f.path}: ${v}`));
    expect(
      offenders,
      'Domain code reached Cloudflare. Use getPlatform() from @repo/platform/current and its ports ' +
        '(db, blobs, config, defer); Cloudflare code belongs in packages/platform-cloudflare:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  describe('its matcher', () => {
    it.each([
      ['the OpenNext context', "import { getCloudflareContext } from '@opennextjs/cloudflare';", 'imports @opennextjs/cloudflare'],
      ['wrangler', "import { getPlatformProxy } from 'wrangler';", 'imports wrangler'],
      ['an adapter subpath', "import { d1Db } from '@repo/platform-cloudflare/d1';", 'imports @repo/platform-cloudflare/d1'],
      ['a dynamic import', "const m = await import('@repo/platform-cloudflare/next');", 'imports @repo/platform-cloudflare/next'],
      ['a require', "const w = require('wrangler');", 'imports wrangler'],
      ['a workers module', "import { env } from 'cloudflare:workers';", 'imports cloudflare:workers'],
      ['a side-effect import', "import 'cloudflare:sockets';", 'imports cloudflare:sockets'],
      ['a mock', "vi.mock('@opennextjs/cloudflare', () => ({}));", 'imports @opennextjs/cloudflare'],
      ['a re-export', "export { getPlatform } from '@repo/platform-cloudflare/next';", 'imports @repo/platform-cloudflare/next'],
      ['the context call', 'const { env } = getCloudflareContext();', 'calls getCloudflareContext()'],
      ['a D1 type', 'export function f(db: D1Database) {}', 'names D1Database'],
      ['an R2 type', 'let bucket: R2Bucket;', 'names R2Bucket'],
      ['the ctx type', 'function h(ctx: ExecutionContext) {}', 'names ExecutionContext'],
      ['the env type', 'const env = {} as CloudflareEnv;', 'names CloudflareEnv'],
      ['a contract outside a test', "import { describeDbContract } from '@repo/platform/contract/db';", 'imports @repo/platform/contract/db outside a test'],
    ])('flags %s', (_label, sample, message) => {
      expect(violations('apps/web/src/lib/x.ts', sample)).toContain(message);
    });

    it('passes neutral code, comments, and the word in a string', () => {
      const good = [
        "import { getPlatform } from '@repo/platform/current';",
        "import type { Db } from '@repo/platform/ports';",
        "logger.warn({ event: 'hash_salt_missing', hint: 'npx wrangler secret put HASH_SALT' });",
        "spawn('npx', ['wrangler', 'tail']);",
        '// getCloudflareContext() is only for the adapters; a D1Database never leaks',
        "const message = 'D1_ERROR: no such table';",
      ].join('\n');
      expect(violations('apps/web/src/lib/x.ts', good)).toEqual([]);
    });

    it('allows a contract suite in a test file', () => {
      expect(violations('packages/x/y.test.ts', "import { describeDbContract } from '@repo/platform/contract/db';")).toEqual([]);
    });
  });
});
