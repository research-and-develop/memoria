import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // apps/web's `@`. Packages never use it (guard:
      // scripts/guards/no-app-alias-in-packages.test.ts), so one alias serves
      // the whole suite. A second app with its own `@` needs its own projects.
      '@': path.resolve(root, 'apps/web/src'),
      // Next aliases these build-guard specifiers to vendored no-ops; vitest
      // does not, and the published `server-only` package throws on import.
      'server-only': path.resolve(root, 'vitest.empty-module.ts'),
      'client-only': path.resolve(root, 'vitest.empty-module.ts'),
    },
  },
  test: {
    projects: [
      {
        // Pure logic, D1 integration and route tests, plus the guard tests.
        // D1 tests need nothing installed or configured: packages/db/test-utils
        // starts an in-memory D1 through wrangler (workerd) per test file.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          pool: 'threads',
          // workerd startup per test file plus CPU contention under a full run;
          // headroom, not cover for a slow test.
          testTimeout: 15_000,
          hookTimeout: 30_000,
          include: ['apps/web/src/**/*.test.ts', 'apps/web/scripts/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
          // The guards read the source tree once per run through this snapshot.
          globalSetup: ['./packages/core/testing/sourceIndexSetup.ts'],
        },
      },
      {
        // React components and hooks. jsdom, jest-dom matchers, auto cleanup —
        // and no database: a component test must run with nothing external.
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          pool: 'threads',
          include: ['apps/web/src/**/*.test.tsx', 'packages/**/*.test.tsx'],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./vitest.setup.components.ts'],
        },
      },
    ],
  },
});
