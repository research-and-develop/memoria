/**
 * Guard: no one-off font sizes (`text-[15px]`, `lg:text-[2.6rem]`).
 *
 * Sizes come from the type scale in packages/ui/tailwind-preset.mjs, used
 * through the typography primitives or the named `text-*` tokens. A one-off
 * size is invisible to the scale: it drifts from the design's rhythm, does not
 * shrink on phones, and tailwind-merge cannot override it predictably.
 * Need a new size? Add a token (and to FONT_SIZE_TOKENS in packages/ui/cn.ts).
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ONE_OFF_RE = /(?:^|[\s"'`:])text-\[(?:\d|\.\d|calc\(|clamp\(|var\()/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

describe('font sizes come from the type scale', () => {
  const files = readSourceFiles({ roots: ['apps/web/src', 'packages/ui'], extensions: ['.ts', '.tsx'] });

  it('scans real source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no one-off text size', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = stripComments(file.text);
      for (const m of text.matchAll(ONE_OFF_RE)) offenders.push(`${file.path}:${lineOf(text, m.index ?? 0)}`);
    }
    expect(offenders, 'Use a typography primitive or a named text-* token:\n  ' + offenders.join('\n  ')).toEqual([]);
  });
});
