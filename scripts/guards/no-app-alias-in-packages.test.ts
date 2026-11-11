/**
 * Guard: a package never imports an app's `@/` alias.
 *
 * `@/` resolves only inside the app whose tsconfig declares it. A package that
 * uses it compiles under that app and breaks the moment a second app imports
 * the package (its `@/` points somewhere else). Inside a package use relative
 * imports; across packages use `@repo/*`.
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

// Not global: `.test()` on a /g regex carries lastIndex from one file into the next.
const APP_ALIAS_RE = /(?:from\s+|import\s*\(\s*|vi\.mock\(\s*|require\(\s*)['"]@\/[^'"]*['"]/;

describe('packages never import an app alias', () => {
  const files = readSourceFiles({ roots: ['packages'], extensions: ['.ts', '.tsx', '.mjs', '.js'] });

  it('scans the packages', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('finds none', () => {
    const offenders = files
      .filter((f) => APP_ALIAS_RE.test(stripComments(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
