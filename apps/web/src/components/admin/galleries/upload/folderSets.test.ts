import { describe, expect, it } from 'vitest';

import { planFolderSets, setNameOf } from './folderSets';

const SETS = [
  { id: 's-main', name: 'Main' },
  { id: 's-cer', name: 'Ceremony' },
];

describe('setNameOf', () => {
  it.each([
    ['Ceremony', 'Ceremony'],
    ['  Party  ', 'Party'],
    ['Cafe\u0301', 'Café'], // NFC
    ['Sofia\u202e', 'Sofia'], // bidi control removed
    ['x'.repeat(80), 'x'.repeat(60)],
    ['   ', ''],
  ])('%j → %j', (folder, expected) => {
    expect(setNameOf(folder)).toBe(expected);
  });
});

describe('planFolderSets', () => {
  it('reuses an existing set of the same name (any case), creates the rest once per name', () => {
    const plan = planFolderSets(['ceremony', 'Party', 'PARTY', '  ', 'Reception'], SETS);
    expect([...plan.existing]).toEqual([['ceremony', 's-cer']]);
    expect([...plan.create]).toEqual([
      ['Party', 'Party'],
      ['PARTY', 'Party'],
      ['Reception', 'Reception'],
    ]);
    expect([...plan.unnamed]).toEqual(['  ']);
  });

  it('nothing to do without folders', () => {
    const plan = planFolderSets([], SETS);
    expect(plan.existing.size + plan.create.size + plan.unnamed.size).toBe(0);
  });
});
