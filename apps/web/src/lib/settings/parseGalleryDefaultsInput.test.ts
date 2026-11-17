import { describe, expect, it } from 'vitest';

import { GALLERY_DEFAULTS, parseGalleryDefaultsInput } from './parseGalleryDefaultsInput';

describe('parseGalleryDefaultsInput', () => {
  it('an empty row is the built-in defaults (owner 2026-11-17: 1600/75, 2048/82, 800/70)', () => {
    expect(parseGalleryDefaultsInput({})).toEqual({ ok: true, value: GALLERY_DEFAULTS });
    expect(GALLERY_DEFAULTS.display).toEqual({ selection: { longEdge: 1600, quality: 75 }, sharing: { longEdge: 2048, quality: 82 } });
    expect(GALLERY_DEFAULTS.thumb).toEqual({ longEdge: 800, quality: 70 });
  });

  it('a partial row keeps the defaults of what it leaves out, per field and per size', () => {
    const parsed = parseGalleryDefaultsInput({ purpose: 'sharing', display: { sharing: { quality: 90 } } });
    expect(parsed).toEqual({
      ok: true,
      value: { ...GALLERY_DEFAULTS, purpose: 'sharing', display: { ...GALLERY_DEFAULTS.display, sharing: { longEdge: 2048, quality: 90 } } },
    });
  });

  it.each([
    [{ display: { selection: { longEdge: 400 } }, thumb: { longEdge: 400 } }, 'display.selection'], // display must exceed thumb
    [{ display: { sharing: { longEdge: 700 } } }, 'display.sharing'], // 700 ≤ thumb 800
    [{ display: { selection: { longEdge: 399 } } }, 'display.selection'],
    [{ display: { selection: { longEdge: 4097 } } }, 'display.selection'],
    [{ display: { selection: { longEdge: 1600.5 } } }, 'display.selection'],
    [{ display: { sharing: { quality: 39 } } }, 'display.sharing'],
    [{ display: { sharing: { quality: 96 } } }, 'display.sharing'],
    [{ thumb: { quality: '70' } }, 'thumb'],
    [{ purpose: 'archive' }, 'purpose'],
    [{ watermarkSelection: 'yes' }, 'watermarkSelection'],
    [{ access: 'invited' }, 'access'], // cut (owner, 2026-11-17)
    [{ delivery: 'protected' }, 'delivery'], // D4.13: until Phase 6 M2
    [{ delivery: 'cdn' }, 'delivery'],
  ])('%j is refused on %s', (input, field) => {
    expect(parseGalleryDefaultsInput(input)).toMatchObject({ ok: false, field });
  });

  it('the bounds are inclusive (400–4096 px, quality 40–95)', () => {
    const edges = { display: { selection: { longEdge: 4096, quality: 95 }, sharing: { longEdge: 4096, quality: 40 } }, thumb: { longEdge: 400, quality: 40 } };
    expect(parseGalleryDefaultsInput(edges)).toMatchObject({ ok: true, value: edges });
  });

  it('protected delivery says it is not available yet', () => {
    expect(parseGalleryDefaultsInput({ delivery: 'protected' })).toMatchObject({ message: 'Protected delivery is not available yet.' });
  });
});
