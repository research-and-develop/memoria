/**
 * Size ratchet: no source file grows past the ceiling unnoticed.
 *
 * 700 lines for production code, 800 for tests. Past it is a review
 * speed-bump, not a ban: prefer splitting the file (pure code motion). If a
 * file genuinely must stay big, add it to file-size-allowlist.json with its
 * current length rounded up — the allowance is a ratchet, so it may shrink but
 * never silently grow. A stale entry (file gone, or back under the ceiling)
 * fails too, so the list stays honest.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readSourceFiles, repoRoot } from '@repo/core/testing/sourceIndex';

const PROD_CEILING = 700;
const TEST_CEILING = 800;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const allowlist = JSON.parse(
  readFileSync(path.join(repoRoot(), 'scripts/guards/file-size-allowlist.json'), 'utf8'),
) as Record<string, number>;

const lineCount = (text: string) => text.split('\n').length;

describe('file size ratchet', () => {
  const files = readSourceFiles({ roots: ['apps/web', 'packages', 'scripts'] });

  it('scans the tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('keeps every file under its ceiling or its allowance', () => {
    const offenders = files.flatMap((file) => {
      const lines = lineCount(file.text);
      const limit = allowlist[file.path] ?? (TEST_FILE_RE.test(file.path) ? TEST_CEILING : PROD_CEILING);
      return lines > limit ? [`${file.path}: ${lines} lines (limit ${limit})`] : [];
    });
    expect(offenders, 'Split the file, or (if it must stay big) record it in file-size-allowlist.json.').toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const byPath = new Map(files.map((f) => [f.path, lineCount(f.text)]));
    const stale = Object.keys(allowlist).filter((p) => {
      const lines = byPath.get(p);
      const ceiling = TEST_FILE_RE.test(p) ? TEST_CEILING : PROD_CEILING;
      return lines === undefined || lines <= ceiling;
    });
    expect(stale, 'Remove these entries: the file is gone or back under the ceiling.').toEqual([]);
  });
});
