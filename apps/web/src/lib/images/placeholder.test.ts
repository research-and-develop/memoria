import { describe, expect, it } from 'vitest';

import { averageColor, placeholderColor } from './placeholder';
import { fakeCanvasFactory } from './testing/fakeCanvas';

const pixels = (...rgba: number[][]) => Uint8ClampedArray.from(rgba.flat());

describe('averageColor', () => {
  it.each([
    ['one red pixel', pixels([255, 0, 0, 255]), 1, 1, '#ff0000'],
    ['black and white → grey', pixels([0, 0, 0, 255], [255, 255, 255, 255]), 2, 1, '#808080'],
    ['four colours', pixels([255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 255]), 2, 2, '#404040'],
    ['transparent counts as white', pixels([0, 0, 0, 0]), 1, 1, '#ffffff'],
    ['half-transparent black', pixels([0, 0, 0, 128]), 1, 1, '#7f7f7f'],
    ['no pixels', new Uint8ClampedArray(), 0, 0, '#ffffff'],
    ['fewer bytes than the size says', pixels([1, 2, 3, 255]), 2, 2, '#ffffff'],
  ])('%s → %s', (_, data, w, h, expected) => {
    expect(averageColor(data, w, h)).toBe(expected);
  });
});

describe('placeholderColor', () => {
  it('averages an 8 px copy on the long edge', () => {
    const { createCanvas, log } = fakeCanvasFactory([10, 20, 30, 255]);
    const color = placeholderColor({ width: 800, height: 533, getContext: () => null }, createCanvas);
    expect(color).toBe('#0a141e');
    expect(log).toEqual(['c1.drawImage(source 800x533, 0, 0, 8, 5) smoothing=high', 'c1.getImageData(8, 5)']);
  });
});
