/**
 * Guard: `twMerge` comes from `@repo/ui/cn`, never from 'tailwind-merge'.
 *
 * The plain tailwind-merge does not know the preset's font-size tokens
 * (`text-heading-md`, `text-body`, …) and reads them as colours, so
 * `twMerge('text-body', 'text-heading-md')` keeps BOTH and the stylesheet order
 * decides — a primitive's `className` override silently stops working.
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const DIRECT_RE = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]tailwind-merge['"]/;

describe('tailwind-merge is only used through @repo/ui/cn', () => {
  const files = readSourceFiles({ roots: ['apps/web/src', 'packages'], extensions: ['.ts', '.tsx'] }).filter(
    (f) => !f.path.replace(/\\/g, '/').endsWith('packages/ui/cn.ts'),
  );

  it('scans real source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no direct import', () => {
    const offenders = files.filter((f) => DIRECT_RE.test(stripComments(f.text))).map((f) => f.path);
    expect(offenders, "Import { twMerge } from '@repo/ui/cn' instead:\n  " + offenders.join('\n  ')).toEqual([]);
  });
});
