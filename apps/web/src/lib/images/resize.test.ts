import { describe, expect, it } from 'vitest';

import { drawResized, stepPlan, targetSize } from './resize';
import { fakeCanvasFactory } from './testing/fakeCanvas';

describe('targetSize', () => {
  it.each([
    ['landscape', 6000, 4000, 1600, { w: 1600, h: 1067 }],
    ['portrait', 4000, 6000, 1600, { w: 1067, h: 1600 }],
    ['square', 3000, 3000, 800, { w: 800, h: 800 }],
    ['panorama', 12000, 2000, 2048, { w: 2048, h: 341 }],
    ['exactly the target', 1600, 900, 1600, { w: 1600, h: 900 }],
    ['smaller than the target: unchanged (never upscales)', 1200, 800, 1600, { w: 1200, h: 800 }],
    ['a sliver keeps 1 px', 10000, 2, 400, { w: 400, h: 1 }],
  ])('%s', (_, w, h, longEdge, expected) => {
    expect(targetSize(w, h, longEdge)).toEqual(expected);
  });
});

describe('stepPlan', () => {
  it.each([
    ['ratio ≤ 2: one step', { w: 3000, h: 2000 }, { w: 1600, h: 1067 }, [{ w: 1600, h: 1067 }]],
    ['6000 → 1600: one halving, then the target', { w: 6000, h: 4000 }, { w: 1600, h: 1067 }, [{ w: 3000, h: 2000 }, { w: 1600, h: 1067 }]],
    ['8000 → 800: halvings while above 2×', { w: 8000, h: 5333 }, { w: 800, h: 533 }, [{ w: 4000, h: 2667 }, { w: 2000, h: 1334 }, { w: 1000, h: 667 }, { w: 800, h: 533 }]],
    ['same size: one step', { w: 800, h: 600 }, { w: 800, h: 600 }, [{ w: 800, h: 600 }]],
  ])('%s', (_, from, to, expected) => {
    expect(stepPlan(from, to)).toEqual(expected);
  });
});

describe('drawResized', () => {
  it('draws each step from the previous one with high-quality smoothing and releases the intermediates', () => {
    const { createCanvas, log, canvases } = fakeCanvasFactory();
    const source = { width: 6000, height: 4000, getContext: () => null };
    const out = drawResized(source, { w: 1600, h: 1067 }, createCanvas);
    expect(log).toEqual(['c1.drawImage(source 6000x4000, 0, 0, 3000, 2000) smoothing=high', 'c2.drawImage(c1, 0, 0, 1600, 1067) smoothing=high']);
    expect(out).toBe(canvases[1]);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); // released
    expect(out).toMatchObject({ width: 1600, height: 1067 });
  });
});
