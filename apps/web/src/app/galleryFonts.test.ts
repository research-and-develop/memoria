import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PAIRING, displayStack, FAMILIES, PAIRINGS, pairing, pairingCovers } from '@repo/ui/theme/galleryFonts';
import { describe, expect, it } from 'vitest';

// Read as source: importing it would run next/font, which only works inside a Next build.
const nextFonts = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'galleryFonts.ts'), 'utf8');

/** The `next/font` calls of galleryFonts.ts: variable → subsets. */
function declaredSubsets(): Map<string, string[]> {
  const calls = [...nextFonts.matchAll(/\w+\(\{([^}]*)\}\)/g)].map((m) => m[1] ?? '');
  return new Map(
    calls.map((body) => {
      const variable = /variable:\s*'([^']+)'/.exec(body)?.[1] ?? '';
      const subsets = [...(/subsets:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
      return [variable, subsets];
    }),
  );
}

describe('gallery font pairings', () => {
  it('ids are unique and the default exists', () => {
    const ids = PAIRINGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_PAIRING);
  });

  it('every display and text face is a registered family', () => {
    for (const p of PAIRINGS) {
      expect(FAMILIES).toHaveProperty(p.display);
      expect(FAMILIES).toHaveProperty(p.text);
    }
  });

  it.each([
    ['editorial', 'editorial'],
    ['nope', DEFAULT_PAIRING],
    [undefined, DEFAULT_PAIRING],
  ])('pairing(%s) → %s', (id, expected) => {
    expect(pairing(id).id).toBe(expected);
  });

  it("a pairing's scripts are what both its faces cover", () => {
    for (const p of PAIRINGS) {
      const covered = FAMILIES[p.display].scripts.filter((s) => FAMILIES[p.text].scripts.includes(s));
      expect([...p.scripts].sort()).toEqual([...covered].sort());
    }
  });

  it('every family loaded by next/font declares the subsets of its scripts, and its variable is registered', () => {
    const declared = declaredSubsets();
    expect(declared.size).toBeGreaterThan(0);
    for (const family of Object.values(FAMILIES)) {
      if (family.variable === '--font-text') continue; // Inter: the studio font (fonts.ts)
      expect(declared.get(family.variable)?.sort()).toEqual([...family.scripts].sort());
    }
    for (const variable of declared.keys()) expect(Object.values(FAMILIES).map((f) => f.variable)).toContain(variable);
  });

  it('the display stack reads the family variable, then its fallback', () => {
    expect(displayStack(pairing('editorial'))).toBe('var(--font-g-instrument), Georgia, serif');
    expect(displayStack(pairing('quiet'))).toBe('var(--font-text), system-ui, sans-serif');
  });

  it.each([
    ['editorial', 'Maria & Jonas', true],
    ['editorial', 'Мария и Йонас', false],
    ['classic', 'Мария и Йонас', true],
    ['modern', 'Мария', false],
  ])('pairingCovers(%s, %s) = %s', (id, text, expected) => {
    expect(pairingCovers(pairing(id), text)).toBe(expected);
  });
});
