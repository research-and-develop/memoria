import { describe, expect, it } from 'vitest';

import { changedWatermarkFields, cleanWatermarkText, parseWatermarkInput, WATERMARK_ANCHORS } from './parseWatermarkInput';

const KEY = 'branding/watermarks/0b6f4a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png';
const PLACEMENT = { position: 'bottom-right', size: 20, opacity: 60, margin: 3 };
const IMAGE = { kind: 'image', key: KEY, width: 800, height: 200, contentType: 'image/png', ...PLACEMENT };
const TEXT = { kind: 'text', text: 'Northlight Studio', font: 'serif', ink: 'light', ...PLACEMENT };

describe('parseWatermarkInput', () => {
  it.each([
    ['none', { kind: 'none', text: 'ignored' }, { kind: 'none' }],
    ['an image', IMAGE, IMAGE],
    ['a text', TEXT, TEXT],
    ['a WebP image', { ...IMAGE, key: KEY.replace('.png', '.webp'), contentType: 'image/webp' }, { ...IMAGE, key: KEY.replace('.png', '.webp'), contentType: 'image/webp' }],
  ])('accepts %s', (_, input, expected) => {
    expect(parseWatermarkInput(input)).toEqual({ ok: true, value: expected });
  });

  it.each([...WATERMARK_ANCHORS, 'tiled'])('accepts the position %s', (position) => {
    expect(parseWatermarkInput({ ...TEXT, position }).ok).toBe(true);
  });

  it('drops unknown fields', () => {
    expect(parseWatermarkInput({ ...TEXT, extra: 1, key: KEY })).toEqual({ ok: true, value: TEXT });
  });

  it.each([
    [{ kind: 'logo' }, 'kind'],
    [null, 'kind'],
    [{ ...TEXT, position: 'middle' }, 'position'],
    [{ ...TEXT, size: 4 }, 'size'],
    [{ ...TEXT, size: 61 }, 'size'],
    [{ ...TEXT, size: 20.5 }, 'size'],
    [{ ...TEXT, opacity: 9 }, 'opacity'],
    [{ ...TEXT, opacity: 101 }, 'opacity'],
    [{ ...TEXT, margin: -1 }, 'margin'],
    [{ ...TEXT, margin: 11 }, 'margin'],
    [{ ...TEXT, margin: '3' }, 'margin'],
    [{ ...TEXT, text: '' }, 'text'],
    [{ ...TEXT, text: '​‮ ' }, 'text'],
    [{ ...TEXT, text: 'x'.repeat(61) }, 'text'],
    [{ ...TEXT, font: 'monospace' }, 'font'],
    [{ ...TEXT, ink: 'red' }, 'ink'],
    [{ ...IMAGE, contentType: 'image/jpeg' }, 'contentType'],
    [{ ...IMAGE, contentType: 'image/svg+xml' }, 'contentType'],
    [{ ...IMAGE, key: 'branding/logos/0b6f4a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png' }, 'key'],
    [{ ...IMAGE, key: 'branding/watermarks/../x.png' }, 'key'],
    [{ ...IMAGE, key: 'branding/watermarks/my-logo.png' }, 'key'],
    [{ ...IMAGE, key: KEY.toUpperCase() }, 'key'],
    [{ ...IMAGE, key: KEY.replace('.png', '.webp') }, 'key'], // extension and type disagree
    [{ ...IMAGE, width: 0 }, 'width'],
    [{ ...IMAGE, height: 4001 }, 'height'],
  ])('refuses %j on %s', (input, field) => {
    expect(parseWatermarkInput(input)).toMatchObject({ ok: false, field });
  });

  it('strips control, format and bidi characters from the text (it is drawn into every photo)', () => {
    expect(parseWatermarkInput({ ...TEXT, text: ' North‮light​\u0007 ' })).toEqual({ ok: true, value: { ...TEXT, text: 'Northlight' } });
    expect(cleanWatermarkText('Мария⁦ и Йонас')).toBe('Мария и Йонас');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(parseWatermarkInput({ ...TEXT, text: '📷'.repeat(60) }).ok).toBe(true);
  });
});

describe('changedWatermarkFields', () => {
  it.each([
    [{ kind: 'none' }, { kind: 'none' }, []],
    [TEXT, { ...TEXT, opacity: 80 }, ['opacity']],
    [{ kind: 'none' }, TEXT, ['font', 'ink', 'kind', 'margin', 'opacity', 'position', 'size', 'text']],
  ] as const)('%j → %j', (before, after, fields) => {
    expect(changedWatermarkFields(before as never, after as never)).toEqual(fields);
  });
});
