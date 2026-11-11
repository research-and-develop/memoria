/**
 * Guard: no client component reads a `NEXT_PUBLIC_*` environment variable.
 *
 * Next inlines `NEXT_PUBLIC_*` into the browser bundle at BUILD time. This app
 * builds ONE image and configures it at RUNTIME, so such a read is a build-time
 * value pretending to be per-environment config: absent at build, the browser
 * gets `undefined` while the server render has the real value (React #418
 * hydration mismatch); present at build, the deployment's setting is silently
 * ignored. Read it in a server module and pass it down (AppProvider).
 *
 * Known limitation: keys off the `'use client'` directive, so a directive-less
 * module imported only by client components is not covered.
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ROOTS = ['apps/web/src', 'packages/ui'];
const CLIENT_DIRECTIVE_RE = /^\s*['"]use client['"]\s*;?/m;
const PUBLIC_ENV_RE =
  /process\s*[?.]*\.?\s*env\s*[?.]*\s*(?:\.\s*(NEXT_PUBLIC_[A-Za-z0-9_]*)|\[\s*['"](NEXT_PUBLIC_[A-Za-z0-9_]*)['"])/g;

function clientFiles() {
  return readSourceFiles({ roots: ROOTS, extensions: ['.ts', '.tsx'], includeTests: false }).filter((f) =>
    CLIENT_DIRECTIVE_RE.test(f.text),
  );
}

describe('client components never read NEXT_PUBLIC_* env vars', () => {
  it('scans real client components (guards against a vacuously empty check)', () => {
    expect(clientFiles().length).toBeGreaterThan(0);
  });

  it('finds none', () => {
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const text = stripComments(file.text);
      const names = new Set<string>();
      for (const m of text.matchAll(PUBLIC_ENV_RE)) names.add(m[1] ?? m[2] ?? '');
      if (names.size) offenders.push(`${file.path} → ${[...names].sort().join(', ')}`);
    }
    expect(
      offenders,
      'A client component reads a NEXT_PUBLIC_* variable (inlined at BUILD time). Read it in a ' +
        'server module and pass it down through AppProvider:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
