import { describe, expect, it } from 'vitest';

import { WATERMARK_INKS } from '@repo/ui/theme/watermark';

import type { Placement, TextWatermark } from '@/lib/settings/parseWatermarkInput';

import { applyWatermark, MAX_TILES, TEXT_REFERENCE_PX, watermarkBox, type Box } from './watermark';

const LANDSCAPE = { w: 1600, h: 1067 };
const PORTRAIT = { w: 1067, h: 1600 };
const MARK = { w: 400, h: 100 }; // 4:1
const at = (position: Placement['position'], extra: Partial<Placement> = {}): Placement => ({ position, size: 25, opacity: 60, margin: 3, ...extra });

describe('watermarkBox: anchors', () => {
  // size 25 % of the long edge 1600 = 400 × 100; margin 3 % of the short edge 1067 = 32.
  it.each([
    ['top-left', LANDSCAPE, { x: 32, y: 32 }],
    ['top', LANDSCAPE, { x: 600, y: 32 }],
    ['top-right', LANDSCAPE, { x: 1168, y: 32 }],
    ['left', LANDSCAPE, { x: 32, y: 484 }],
    ['center', LANDSCAPE, { x: 600, y: 484 }],
    ['right', LANDSCAPE, { x: 1168, y: 484 }],
    ['bottom-left', LANDSCAPE, { x: 32, y: 935 }],
    ['bottom', LANDSCAPE, { x: 600, y: 935 }],
    ['bottom-right', LANDSCAPE, { x: 1168, y: 935 }],
    ['top-left', PORTRAIT, { x: 32, y: 32 }],
    ['center', PORTRAIT, { x: 334, y: 750 }],
    ['bottom-right', PORTRAIT, { x: 635, y: 1468 }],
  ] as const)('%s on %j', (position, photo, expected) => {
    expect(watermarkBox(photo, MARK, at(position))).toEqual([{ ...expected, w: 400, h: 100 }]);
  });

  it('the size is a percentage of the long edge, the margin of the short edge, in both orientations', () => {
    const [landscape] = watermarkBox(LANDSCAPE, MARK, at('top-left', { size: 10, margin: 10 }));
    const [portrait] = watermarkBox(PORTRAIT, MARK, at('top-left', { size: 10, margin: 10 }));
    expect(landscape).toEqual({ x: 107, y: 107, w: 160, h: 40 });
    expect(portrait).toEqual(landscape);
  });

  it('a mark larger than the photo is scaled down to fit (and kept inside it)', () => {
    const tall = { w: 100, h: 400 };
    const [box] = watermarkBox(LANDSCAPE, tall, at('center', { size: 60 })) as [Box];
    expect(box.h).toBe(1067);
    expect(box.w).toBe(267);
    expect(box.y).toBe(0);
    const [corner] = watermarkBox(LANDSCAPE, tall, at('bottom-right', { size: 60, margin: 10 })) as [Box];
    expect(corner.y).toBe(0); // the margin cannot push it off the photo
    expect(corner.x + corner.w).toBeLessThanOrEqual(1600);
  });
});

describe('watermarkBox: tiled', () => {
  it('steps of 2w × 2.5h from (−w, −h), every other row offset by w, margin ignored', () => {
    const boxes = watermarkBox({ w: 1000, h: 600 }, MARK, at('tiled', { size: 10, margin: 10 })); // 100 × 25
    expect(boxes[0]).toEqual({ x: -100, y: -25, w: 100, h: 25 });
    expect(boxes[1]).toEqual({ x: 100, y: -25, w: 100, h: 25 });
    const secondRow = boxes.filter((b) => b.y === -25 + 63);
    expect(secondRow[0]?.x).toBe(0);
    const rows = new Set(boxes.map((b) => b.y));
    expect(rows.size).toBe(Math.ceil((600 + 25) / 63));
    for (const b of boxes) expect(b.x < 1000 && b.y < 600).toBe(true);
  });

  it(`never more than ${MAX_TILES} boxes (the mark grows instead)`, () => {
    const boxes = watermarkBox({ w: 4000, h: 4000 }, MARK, at('tiled', { size: 5 })); // 200 × 50: ~360 tiles before growing
    expect(boxes.length).toBeLessThanOrEqual(MAX_TILES);
    expect(boxes[0]!.w).toBeGreaterThan(200);
  });
});

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: { op: string; args: unknown[]; state: Record<string, unknown> }[] = [];
  type Recorded = Record<string, unknown> & { globalAlpha: number; font: string; fillStyle: unknown; shadowColor: string; shadowOffsetX: number; textBaseline: string };
  const ctx: Recorded = {
    globalAlpha: 1,
    font: '',
    fillStyle: '',
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    textBaseline: 'alphabetic',
    save: () => calls.push({ op: 'save', args: [], state: {} }),
    restore: () => calls.push({ op: 'restore', args: [], state: {} }),
    drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args, state: { globalAlpha: ctx.globalAlpha } }),
    // Every glyph is 0.5 em wide.
    measureText: (text: string) => ({ width: text.length * Number.parseFloat(String(ctx.font)) * 0.5 }),
    fillText: (...args: unknown[]): number =>
      calls.push({ op: 'fillText', args, state: { font: ctx.font, fillStyle: ctx.fillStyle, shadowColor: ctx.shadowColor, shadowOffsetX: ctx.shadowOffsetX, globalAlpha: ctx.globalAlpha, textBaseline: ctx.textBaseline } }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('applyWatermark', () => {
  it('an image: alpha from the opacity, one drawImage per box, the context restored', () => {
    const { ctx, calls } = recorder();
    const bitmap = { width: 400, height: 100 } as ImageBitmap;
    applyWatermark(ctx, LANDSCAPE, { kind: 'image', key: 'k', width: 400, height: 100, contentType: 'image/png', ...at('bottom-right'), opacity: 40 }, { bitmap });
    expect(calls.map((c) => c.op)).toEqual(['save', 'drawImage', 'restore']);
    expect(calls[1]).toMatchObject({ args: [bitmap, 1168, 935, 400, 100], state: { globalAlpha: 0.4 } });
  });

  it('a text: the font scaled so the text fills the box width, fill and shadow from WATERMARK_INKS', () => {
    const { ctx, calls } = recorder();
    const text: TextWatermark = { kind: 'text', text: 'Northlight', font: 'serif', ink: 'dark', ...at('top-left') };
    applyWatermark(ctx, LANDSCAPE, text, { bitmap: null });
    const fill = calls.find((c) => c.op === 'fillText')!;
    // 10 glyphs × 0.5 em at 100 px = 500 px measured; the box is 400 px wide → 80 px.
    expect(fill.state.font).toBe("80px Georgia, 'Times New Roman', serif");
    expect(fill.state.fillStyle).toBe(WATERMARK_INKS.dark.fill);
    expect(fill.state.shadowColor).toBe(WATERMARK_INKS.dark.shadow);
    expect(fill.state.shadowOffsetX).toBe(3); // round(80 / 24)
    expect(fill.state.textBaseline).toBe('top');
    expect(fill.state.globalAlpha).toBe(0.6);
    expect(fill.args[0]).toBe('Northlight');
    expect(fill.args[1]).toBe(32);
    expect(TEXT_REFERENCE_PX).toBe(100);
    expect(calls.at(-1)?.op).toBe('restore');
  });

  it('the shadow offset is at least 1 px', () => {
    const { ctx, calls } = recorder();
    applyWatermark(ctx, { w: 200, h: 100 }, { kind: 'text', text: 'Northlight', font: 'sans', ink: 'light', ...at('center', { size: 5 }) }, { bitmap: null });
    expect(calls.find((c) => c.op === 'fillText')!.state.shadowOffsetX).toBe(1);
  });

  it('an image without its bitmap draws nothing', () => {
    const { ctx, calls } = recorder();
    applyWatermark(ctx, LANDSCAPE, { kind: 'image', key: 'k', width: 1, height: 1, contentType: 'image/png', ...at('center') }, { bitmap: null });
    expect(calls.map((c) => c.op)).toEqual(['save', 'restore']);
  });
});
