/**
 * Guard: no date is rendered in the HOST locale.
 *
 * `toLocaleDateString()` / `toLocaleString(undefined, …)` / `Intl.DateTimeFormat()`
 * take whatever the machine speaks: under Node a test passes on one
 * workstation and fails on a colleague's, and in the browser the same call
 * follows the viewer's OS, so two users read one date two ways.
 * Render through `formatDate` / `DateText` from `@repo/ui/date`, or pin the
 * locale explicitly ('en-GB'). Tests are scanned too.
 *
 * `@repo/ui/date` is a client module: a server component (an `app/**` file
 * without 'use client') cannot CALL `formatDate` from it — it renders `<DateText>`
 * or a server helper with an explicit locale and time zone (`apps/web/src/lib/dates.ts`).
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ROOTS = ['apps/web', 'packages', 'scripts'];

const HOST_LOCALE_RES = [
  /\.toLocale(?:Date|Time)?String\(\s*undefined\b/g,
  /\.toLocale(?:Date|Time)String\(\s*\)/g,
  /Intl\.DateTimeFormat\(\s*(?:undefined\b|\))/g,
  /new Date\([^()]*\)\s*\.toLocaleString\(\s*\)/g,
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('dates are never rendered in the host locale', () => {
  const files = readSourceFiles({ roots: ROOTS, extensions: ['.ts', '.tsx'] }).filter(
    // This file names every banned spelling in its own regexes.
    (f) => !f.path.endsWith('no-host-locale-date.test.ts'),
  );

  it('scans real source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('finds none', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = stripComments(file.text);
      for (const re of HOST_LOCALE_RES) {
        for (const m of text.matchAll(re)) offenders.push(`${file.path}:${lineOf(text, m.index ?? 0)}`);
      }
    }
    expect(
      offenders,
      'A date is rendered in the host locale. Use formatDate / DateText from @repo/ui/date, or pin ' +
        "the locale ('en-GB'):\n  " +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('server components do not call the client-only formatDate', () => {
    const serverFiles = files.filter(
      (f) => f.path.includes('apps/web/src/app/') && !/\.test\.tsx?$/.test(f.path) && !/^\s*['"]use client['"]/.test(f.text),
    );
    expect(serverFiles.length).toBeGreaterThan(3);
    const offenders = serverFiles
      .filter((f) => /import\s*\{[^}]*\b(?:formatDate|toDate)\b[^}]*\}\s*from\s*'@repo\/ui\/date'/.test(stripComments(f.text)))
      .map((f) => f.path);
    expect(offenders, `Use <DateText> or a helper from apps/web/src/lib/dates.ts:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
