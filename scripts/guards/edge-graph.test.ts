/**
 * Guard: the Worker entry (apps/web/worker.ts) reaches only edge-safe code (plan p06 D6.6).
 *
 * `worker.ts` answers `/healthz` and the client galleries BEFORE Next loads, and imports OpenNext lazily
 * on the Next path only. Everything it reaches by a runtime import is bundled outside Next and
 * evaluated at isolate startup, so it must stay free of:
 * - `server-only` (it throws outside Next's bundler) and `@repo/db/client` (it imports `server-only`
 *   and the composition root) — build statements with `@repo/db/statement`;
 * - `@repo/platform/current` (Next's composition root: `worker.ts` builds its own deps from `env`);
 * - Next, React, OpenNext (a static import would also defeat the lazy one), `@repo/api`, `@repo/ui`
 *   (except the plain-data `theme/`);
 * - a query module's `index.ts` barrel (it `export *`s the executing functions, hence
 *   `@repo/db/client`): the public builders are imported by path (`queries/<table>/public.ts`).
 * `@repo/logger`, `@repo/db/rows`, `@repo/db/statement` and type imports are fine. The alias map is
 * EMPTY (wrangler bundles `worker.ts` with no `alias`); `./.open-next/worker.js` exists only after a
 * build and is ignored. The walker: ./importGraph.ts (shared with `relay-graph`).
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles } from '@repo/core/testing/sourceIndex';

import { walkImports, type GraphRules } from './importGraph';

const ENTRY = 'apps/web/worker.ts';
const OPEN_NEXT = './.open-next/worker.js';
const NO_ALIAS: Readonly<Record<string, string>> = {};

const BANNED_PACKAGE_RE = /^(?:server-only|next|react|react-dom|@opennextjs\/[^/]+)(?:\/|$)/;
const BANNED_FILES: Record<string, string> = {
  'packages/db/client.ts': '@repo/db/client imports server-only and the composition root: use @repo/db/statement',
  'packages/platform/current.ts': "Next's composition root: worker.ts builds its deps from env",
  'packages/platform-cloudflare/next.ts': 'the OpenNext wrapper',
};
const BARREL_RE = /^apps\/web\/src\/lib\/db\/queries\/[^/]+\/index\.ts$/;

function bannedFile(file: string): string | null {
  if (BANNED_FILES[file]) return BANNED_FILES[file];
  if (BARREL_RE.test(file)) return 'a query module barrel (reaches @repo/db/client): import queries/<table>/public by path';
  if (file.startsWith('packages/api/')) return '@repo/api (the HTTP envelope, Next routes only)';
  if (file.startsWith('packages/ui/') && !file.startsWith('packages/ui/theme/')) return '@repo/ui (React; only @repo/ui/theme/* is plain data)';
  return null;
}

const EDGE_RULES: GraphRules = {
  bannedPackage: (spec) => BANNED_PACKAGE_RE.test(spec),
  bannedFile,
  ignoreUnresolved: (spec, from) => spec === OPEN_NEXT && from === ENTRY,
};

const edgeWalk = (entry: string, sources: ReadonlyMap<string, string>) => walkImports(entry, sources, NO_ALIAS, EDGE_RULES);

const sources = new Map(readSourceFiles({ roots: ['apps/web', 'packages'] }).map((f) => [f.path, f.text]));
const PUBLIC_BUILDERS = [...sources.keys()].filter((f) => /^apps\/web\/src\/lib\/db\/queries\/[^/]+\/public\.ts$/.test(f));

describe('worker.ts reaches only edge-safe code', () => {
  it('finds the entry and walks into the edge code', () => {
    expect(sources.has(ENTRY)).toBe(true);
    const { reached } = edgeWalk(ENTRY, sources);
    expect([...reached]).toEqual(expect.arrayContaining(['apps/web/src/lib/edge/routes.ts', 'apps/web/src/lib/edge/gallery/markers.mjs']));
  });

  it('reaches no server-only, @repo/db/client, composition root, Next, React, OpenNext or barrel', () => {
    const { violations } = edgeWalk(ENTRY, sources);
    expect(violations, `worker.ts reaches code it must not bundle (plan p06 D6.6):\n  ${violations.join('\n  ')}`).toEqual([]);
  });

  it('every public read builder (queries/<table>/public.ts) is edge-safe', () => {
    expect(PUBLIC_BUILDERS.length).toBeGreaterThan(0);
    const found = PUBLIC_BUILDERS.flatMap((file) => edgeWalk(file, sources).violations);
    expect(found, `A public builder reaches code worker.ts must not bundle:\n  ${found.join('\n  ')}`).toEqual([]);
  });

  describe('its matcher', () => {
    const sample = (files: Record<string, string>) => new Map(Object.entries(files));

    it('catches server-only reached from worker.ts, and prints the chain', () => {
      const files = sample({
        [ENTRY]: "import { x } from './src/lib/edge/x';",
        'apps/web/src/lib/edge/x.ts': "import 'server-only';\nexport const x = 1;",
      });
      expect(edgeWalk(ENTRY, files).violations).toEqual([`${ENTRY} → apps/web/src/lib/edge/x.ts → server-only`]);
    });

    it('@repo/db/rows, @repo/db/statement and @repo/logger pass; @repo/db/client does not', () => {
      const files = sample({
        [ENTRY]: [
          "import { readJson } from '@repo/db/rows';",
          "import { statement } from '@repo/db/statement';",
          "import { logger } from '@repo/logger';",
        ].join('\n'),
        'packages/db/rows.ts': 'export const readJson = 1;',
        'packages/db/statement.ts': "import type { Statement } from '@repo/platform/ports';\nexport const statement = 1;",
        'packages/logger/index.ts': 'export const logger = 1;',
      });
      expect(edgeWalk(ENTRY, files).violations).toEqual([]);
      expect(edgeWalk(ENTRY, sample({ [ENTRY]: "import { run } from '@repo/db/client';", 'packages/db/client.ts': '' })).violations).toEqual([
        `${ENTRY} → packages/db/client.ts (${BANNED_FILES['packages/db/client.ts']})`,
      ]);
    });

    it('catches a query module imported through its barrel, passes it by path', () => {
      const files = sample({
        [ENTRY]: "import { a } from '@/lib/db/queries/site_settings';\nimport { b } from '@/lib/db/queries/site_settings/public';",
        'apps/web/src/lib/db/queries/site_settings/index.ts': "export * from './get';",
        'apps/web/src/lib/db/queries/site_settings/public.ts': 'export const b = 1;',
      });
      expect(edgeWalk(ENTRY, files).violations).toEqual([
        `${ENTRY} → apps/web/src/lib/db/queries/site_settings/index.ts (a query module barrel (reaches @repo/db/client): import queries/<table>/public by path)`,
      ]);
    });

    it('catches the composition root (the alias map is empty)', () => {
      const files = sample({ [ENTRY]: "import { getPlatform } from '@repo/platform/current';", 'packages/platform/current.ts': '' });
      expect(edgeWalk(ENTRY, files).violations).toHaveLength(1);
    });

    it('catches a static import of OpenNext, ignores the lazy one from worker.ts only', () => {
      expect(edgeWalk(ENTRY, sample({ [ENTRY]: `const m = await import('${OPEN_NEXT}');` })).violations).toEqual([]);
      // Any @opennextjs/* package (the sample avoids the adapter's own name: guard platform-boundary).
      expect(edgeWalk(ENTRY, sample({ [ENTRY]: "import { x } from '@opennextjs/aws';" })).violations).toEqual([`${ENTRY} → @opennextjs/aws`]);
      const elsewhere = sample({ [ENTRY]: "import './src/y';", 'apps/web/src/y.ts': `import '${OPEN_NEXT}';` });
      expect(edgeWalk(ENTRY, elsewhere).violations).toEqual([`${ENTRY} → apps/web/src/y.ts → ${OPEN_NEXT} (not found)`]);
    });

    it('catches Next and React', () => {
      const files = sample({ [ENTRY]: "import { NextResponse } from 'next/server';\nimport { useState } from 'react';" });
      expect(edgeWalk(ENTRY, files).violations).toEqual([`${ENTRY} → next/server`, `${ENTRY} → react`]);
    });
  });
});
