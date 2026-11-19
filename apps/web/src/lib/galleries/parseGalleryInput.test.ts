import { describe, expect, it } from 'vitest';

import { BRANDING_DEFAULTS } from '@/lib/settings/parseBrandingInput';
import { GALLERY_DEFAULTS } from '@/lib/settings/parseGalleryDefaultsInput';

import { parseGalleryInput, parseGalleryPatch } from './parseGalleryInput';

const ctx = { defaults: GALLERY_DEFAULTS, branding: BRANDING_DEFAULTS };
const parse = (body: Record<string, unknown>) => parseGalleryInput({ title: 'Maria & Jonas', ...body }, ctx);

describe('parseGalleryInput', () => {
  it('fills the defaults: purpose sizes, the watermark for selection galleries, the branding look', () => {
    const result = parse({});
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        purpose: 'selection',
        access: 'link',
        password: null,
        display: GALLERY_DEFAULTS.display.selection,
        thumb: GALLERY_DEFAULTS.thumb,
        watermark: true,
        theme: 'auto',
        accent: 'pine',
        font: 'classic',
        sort: 'filename',
      }),
    });
    expect(parse({ purpose: 'sharing' })).toMatchObject({ ok: true, value: { display: GALLERY_DEFAULTS.display.sharing, watermark: false } });
  });

  it('cleans the text fields: trimmed, invisible characters removed, empty → null', () => {
    const result = parse({ title: '  Maria​ & Jonas‮ ', clientName: '  ', clientEmail: ' maria@EXAMPLE.com ', shootDate: '' });
    expect(result).toMatchObject({ ok: true, value: { title: 'Maria & Jonas', clientName: null, clientEmail: 'maria@example.com', shootDate: null } });
  });

  it.each([
    ['title', { title: '   ' }],
    ['title', { title: 'x'.repeat(121) }],
    ['shootDate', { shootDate: '2026-02-30' }],
    ['clientName', { clientName: 'x'.repeat(81) }],
    ['clientEmail', { clientEmail: 'nope' }],
    ['slugBase', { slugBase: 'Upper' }],
    ['slugBase', { slugBase: 'x'.repeat(41) }],
    ['purpose', { purpose: 'other' }],
    ['access', { access: 'open' }],
    ['password', { access: 'password' }],
    ['password', { access: 'password', password: 'short' }],
    ['password', { access: 'password', password: ' spaced-out ' }],
    ['password', { access: 'password', password: 'x'.repeat(65) }],
    ['display', { display: { longEdge: 300, quality: 75 } }],
    ['display', { display: { longEdge: 1600, quality: 99 } }],
    ['display', { display: { longEdge: 800, quality: 75 } }],
    ['watermark', { watermark: 'yes' }],
    ['theme', { theme: 'sepia' }],
    ['accent', { accent: 'neon' }],
    ['font', { font: 'comic' }],
    ['grid', { grid: 'list' }],
    ['sort', { sort: 'random' }],
    ['welcome', { welcome: 'x'.repeat(1001) }],
  ])('refuses a bad %s', (field, body) => {
    expect(parse(body)).toMatchObject({ ok: false, field });
  });

  it('keeps line breaks in the welcome note and drops other control characters', () => {
    expect(parse({ welcome: 'Hello\nworld\u0007​' })).toMatchObject({ ok: true, value: { welcome: 'Hello\nworld' } });
  });
});

describe('parseGalleryPatch', () => {
  it('takes only the fields sent', () => {
    expect(parseGalleryPatch({ title: ' New ', accent: 'rose' })).toEqual({ ok: true, value: { title: 'New', accent: 'rose' } });
    expect(parseGalleryPatch({ access: 'link' })).toEqual({ ok: true, value: { access: 'link', password: null } });
    expect(parseGalleryPatch({ clientEmail: '' })).toEqual({ ok: true, value: { clientEmail: null } });
  });

  it.each([
    ['processing', { processing: {} }],
    ['purpose', { purpose: 'sharing' }],
    ['display', { display: { longEdge: 2048, quality: 80 } }],
    ['watermark', { watermark: false }],
    ['slug', { slug: '-bad' }],
    ['slugBase', { slugBase: '' }],
    ['password', { access: 'password', password: 'short' }],
    ['body', {}],
    ['body', { unknown: 1 }],
  ])('refuses %s', (field, body) => {
    expect(parseGalleryPatch(body)).toMatchObject({ ok: false, field });
  });
});
