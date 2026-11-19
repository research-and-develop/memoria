import { describe, expect, it } from 'vitest';

import { buildTiff } from '../fixtures';
import { cameraName, exifDate, readExif, shutter } from './read';

describe('exifDate', () => {
  it.each([
    ['2026:06:14 15:42:07', '2026-06-14T15:42:07'],
    ['2026:06:14 15:42:07.123', '2026-06-14T15:42:07'],
    ['2026-06-14T15:42:07', null], // not EXIF's form
    ['0000:00:00 00:00:00', null],
    ['    :  :     :  :  ', null],
    ['2026:13:01 10:00:00', null],
    ['2026:01:01 24:00:00', null],
    ['', null],
    [null, null],
  ])('%j → %j', (input, expected) => {
    expect(exifDate(input)).toBe(expected);
  });
});

describe('cameraName', () => {
  it.each([
    ['Canon', 'Canon EOS R5', 'Canon EOS R5'],
    ['NIKON CORPORATION', 'NIKON Z 6_2', 'NIKON Z 6_2'],
    ['SONY', 'ILCE-7M4', 'SONY ILCE-7M4'],
    ['FUJIFILM', 'X-T5', 'FUJIFILM X-T5'],
    [null, 'X-T5', 'X-T5'],
    ['Apple', null, 'Apple'],
    [null, null, null],
  ])('%j + %j → %j', (make, model, expected) => {
    expect(cameraName(make, model)).toBe(expected);
  });
});

describe('shutter', () => {
  it.each([
    [0.004, '1/250'],
    [1 / 8000, '1/8000'],
    [0.5, '1/2'],
    [1, '1'],
    [2.5, '2.5'],
    [30, '30'],
  ])('%d s → %s', (seconds, expected) => {
    expect(shutter(seconds)).toBe(expected);
  });
});

describe('readExif: lenient', () => {
  it('missing tags are absent, a bad orientation reads as 1, control characters are dropped', () => {
    const tiff = buildTiff({
      ifd0: [
        { tag: 0x010f, type: 2, value: 'Can\u0007on\u202e' },
        { tag: 0x0112, type: 3, value: [9] },
      ],
    });
    expect(readExif(tiff)).toEqual({ orientation: 1, takenAt: null, meta: { camera: 'Canon' } });
  });

  it('nonsense numbers are left out', () => {
    const tiff = buildTiff({
      ifd0: [{ tag: 0x0112, type: 3, value: [8] }],
      exif: [
        { tag: 0x829a, type: 5, value: [[1, 0]] },
        { tag: 0x829d, type: 5, value: [[0, 1]] },
        { tag: 0x8827, type: 3, value: [0] },
        { tag: 0x920a, type: 5, value: [[35, 1]] },
      ],
    });
    expect(readExif(tiff)).toEqual({ orientation: 8, takenAt: null, meta: { focal: 35 } });
  });
});
