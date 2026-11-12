/**
 * Guard: colours come from the theme, never from a literal.
 *
 * Every colour value lives in packages/ui/theme/ (studio.mjs). Components use colour ROLES
 * (`bg-accent`, `text-ink-muted`), which read CSS variables, so restyling the app, or giving a
 * client gallery its own theme, is a change to the theme alone. A literal (`'#1F6F5C'`,
 * `bg-[#fff]`, `rgba(0,0,0,.5)`) bypasses that: it survives a restyle and breaks theming.
 * `rgb(var(--color-…))` is allowed (it reads a role). Tailwind's default palette (`bg-blue-500`)
 * cannot drift in either: the preset replaces it with the roles.
 * Need a new colour? Add a role to theme/studio.mjs (and a contrast row in colorContrast.test.ts).
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const HEX_RE = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\((?!\s*var\()/g;
const THEME_DIR = 'packages/ui/theme/';

export function rawColors(source: string): string[] {
  const text = stripComments(source);
  return [...text.matchAll(HEX_RE), ...text.matchAll(COLOR_FN_RE)].map((m) => m[0]);
}

describe('colours come from the theme', () => {
  const files = readSourceFiles({ roots: ['apps/web/src', 'packages/ui'], extensions: ['.ts', '.tsx', '.mjs'], includeTests: false }).filter(
    (f) => !f.path.replace(/\\/g, '/').startsWith(THEME_DIR),
  );

  it('scans real source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no colour literal outside packages/ui/theme', () => {
    const offenders = files.flatMap((f) => rawColors(f.text).map((c) => `${f.path}: ${c}`));
    expect(offenders, 'Use a colour role (bg-accent, text-ink-muted, …) or add one to packages/ui/theme/studio.mjs:\n  ' + offenders.join('\n  ')).toEqual([]);
  });

  it('catches the mistakes it is for', () => {
    expect(rawColors(`const c = '#1F6F5C';`)).toEqual(['#1F6F5C']);
    expect(rawColors(`<div className="bg-[#fff] text-ink" />`)).toEqual(['#fff']);
    expect(rawColors(`style={{ color: 'rgba(0, 0, 0, 0.5)' }}`)).toEqual(['rgba(']);
    expect(rawColors(`style={{ color: 'hsl(120 50% 50%)' }}`)).toEqual(['hsl(']);
    // Allowed: roles, variables, ids and entities that only look similar.
    expect(rawColors(`<div className="bg-accent text-ink-muted ring-focus/25" />`)).toEqual([]);
    expect(rawColors(`const v = 'rgb(var(--color-accent) / 0.5)';`)).toEqual([]);
    expect(rawColors(`<a href="#main">Skip</a> &#123; // '#fff' in a comment`)).toEqual([]);
  });
});
