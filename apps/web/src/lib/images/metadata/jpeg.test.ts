import { createHash } from 'node:crypto';

import exifr from 'exifr';
import { describe, expect, it } from 'vitest';

import {
  app13,
  app1Exif,
  app1ExifRaw,
  app1ExtendedXmp,
  app1Xmp,
  app2Mpf,
  appN,
  base,
  buildTiff,
  cameraExif,
  cameraIptc,
  cameraJpeg,
  com,
  containsBytes,
  irbResource,
  iptcDataset,
  jpegWith,
  SECRETS,
  segment,
  ucs2,
  type ExifSpec,
} from '../fixtures';
import { MARKERS, parseJpeg, payloadOf, type Segment } from './jpeg';
import { stripMetadata } from './strip';

type Parsed = Record<string, Record<string, unknown> | undefined>;
const ALL = { tiff: true, exif: true, gps: true, interop: true, ifd1: true, xmp: true, iptc: true, icc: false, jfif: true, makerNote: true, userComment: true, multiSegment: true, mergeOutput: false } as const;
const parse = async (bytes: Uint8Array): Promise<Parsed> => ((await exifr.parse(Buffer.from(bytes), ALL)) ?? {}) as Parsed;

/** What exifr finds in a cleaned file: only these blocks, and nothing that names a place. */
function expectNoLocation(parsed: Parsed): void {
  expect(Object.keys(parsed).filter((k) => !['jfif', 'iptc', 'ifd0', 'exif', 'interop'].includes(k))).toEqual([]);
  expect(JSON.stringify(parsed)).not.toMatch(/GPS|latitude|longitude|City|Sublocation|State|Country/i);
}

function strip(bytes: Uint8Array) {
  const result = stripMetadata(bytes, 'image/jpeg');
  if (!result.ok) throw new Error(`refused: ${result.reason} (${result.detail})`);
  return result;
}

const secretNeedles = (): [string, string | Uint8Array][] => [
  ...Object.entries(SECRETS)
    .filter(([k]) => !k.startsWith('xp')) // Windows writes those as UTF-16
    .map(([k, v]) => [k, v] as [string, string]),
  ...(['xpTitle', 'xpComment', 'xpAuthor', 'xpKeywords', 'xpSubject'] as const).map((k) => [`${k} (UCS-2)`, ucs2(SECRETS[k]).subarray(0, -2)] as [string, Uint8Array]),
];

const markers = (bytes: Uint8Array) => parseJpeg(bytes).map((s) => s.marker);
const scans = (bytes: Uint8Array) =>
  parseJpeg(bytes)
    .filter((s) => s.marker === MARKERS.SOS)
    .map((s) => createHash('sha256').update(bytes.subarray(s.start, s.end)).digest('hex'));
const app = (bytes: Uint8Array, marker: number): Segment[] => parseJpeg(bytes).filter((s) => s.marker === marker);

describe('the fixtures are what they claim (read by exifr)', () => {
  it.each(['II', 'MM'] as const)('the camera JPEG (%s) carries GPS, XMP, IPTC location, IFD1 and a MakerNote', async (order) => {
    const input = cameraJpeg({ order });
    const parsed = await parse(input);
    expect(parsed.gps?.latitude).toBeCloseTo(42.6917, 3);
    expect(parsed.gps?.longitude).toBeCloseTo(23.3201, 3);
    expect(parsed.photoshop?.City).toBe(SECRETS.xmp); // exifr folds XMP into its namespaces
    expect(parsed.exif?.GPSLatitude).toBe('42,41.5N'); // exif:GPSLatitude from the XMP
    expect(parsed.iptc?.City).toBe(SECRETS.iptcCity);
    expect(parsed.ifd1).toMatchObject({ ThumbnailLength: base.jpeg().length });
    expect(parsed.makerNote).toBeDefined();
    expect(parsed.userComment).toBeDefined();
    expect(parsed.exif?.OwnerName).toBe(SECRETS.owner);
    expect(parsed.ifd0).toMatchObject({ ImageDescription: SECRETS.description, XPTitle: SECRETS.xpTitle });
    for (const [name, needle] of secretNeedles()) expect(containsBytes(input, needle), name).toBe(true);
  });
});

describe('stripMetadata: JPEG', () => {
  it.each(['II', 'MM'] as const)('the camera JPEG (%s): no location anywhere, the kept tags still read', async (order) => {
    const input = cameraJpeg({ order });
    const { bytes } = strip(input);
    for (const [name, needle] of secretNeedles()) expect(containsBytes(bytes, needle), name).toBe(false);

    const parsed = await parse(bytes);
    expectNoLocation(parsed);
    expect(parsed.ifd0).toEqual({ Make: 'Canon', Model: 'Canon EOS R5', Orientation: 'Horizontal (normal)', Artist: 'Ana Petrova', Copyright: '(c) Ana Petrova' });
    expect(parsed.exif).toEqual({ ExposureTime: 0.004, FNumber: 2.8, ISO: 400, DateTimeOriginal: expect.anything(), FocalLength: 50, LensMake: 'Canon', LensModel: 'RF50mm F1.2 L USM' });
    expect(parsed.interop).toEqual({ InteropIndex: 'R98' });
    expect(parsed.iptc).toEqual({ ApplicationRecordVersion: '\u0000\u0004', ObjectName: 'Wedding of M and J', Byline: 'Ana Petrova', CopyrightNotice: '(c) Ana Petrova', Caption: 'First dance' });
  });

  it('the output segment list is exactly the allow-list, in order', () => {
    const { bytes } = strip(cameraJpeg());
    const DQT = MARKERS.DQT;
    const DHT = MARKERS.DHT;
    expect(markers(bytes)).toEqual([MARKERS.SOI, MARKERS.APP0, MARKERS.APP1, MARKERS.APP13, MARKERS.APP2, DQT, DQT, 0xc0, DHT, DHT, DHT, DHT, MARKERS.SOS, MARKERS.EOI]);
    expect(app(bytes, MARKERS.APP2).map((s) => Buffer.from(payloadOf(bytes, s).subarray(0, 12)).toString('latin1'))).toEqual(['ICC_PROFILE\0']);
    expect(bytes.length).toBeLessThan(cameraJpeg().length);
  });

  it('the scan data is byte-identical and the ICC profile is kept as it was', () => {
    const input = cameraJpeg();
    const { bytes } = strip(input);
    expect(scans(bytes)).toEqual(scans(input));
    expect(scans(bytes)).toEqual(scans(base.jpeg()));
    const icc = (b: Uint8Array) => app(b, MARKERS.APP2).map((s) => Buffer.from(b.subarray(s.start, s.end)).toString('hex'));
    expect(icc(bytes)).toEqual(icc(base.jpeg()).slice(0, 1));
  });

  it('a JPEG without metadata comes back byte-identical', () => {
    const input = base.jpeg();
    const result = strip(input);
    expect(Buffer.from(result.bytes).equals(Buffer.from(input))).toBe(true);
    expect(result).toMatchObject({ width: 24, height: 16, exif: { orientation: 1, takenAt: null, meta: {} } });
  });

  it('reads orientation, capture time and the camera from the cleaned EXIF', () => {
    const result = strip(cameraJpeg({ order: 'MM', orientation: 6 }));
    expect(result.width).toBe(24);
    expect(result.height).toBe(16);
    expect(result.exif).toEqual({
      orientation: 6,
      takenAt: '2026-06-14T15:42:07',
      meta: { camera: 'Canon EOS R5', lens: 'Canon RF50mm F1.2 L USM', focal: 50, aperture: 2.8, shutter: '1/250', iso: 400 },
    });
  });
});

describe('the GPS entry is removed in place', () => {
  it.each(['II', 'MM'] as const)('%s: IFD0 count one less, the next-IFD pointer moved up 12 bytes, freed and GPS bytes zero', (order) => {
    const spec: ExifSpec = {
      order,
      ifd0: [
        { tag: 0x010f, type: 2, value: 'Canon' },
        { tag: 0x0110, type: 2, value: 'Canon EOS R5' },
      ],
      gps: cameraExif().gps,
    };
    const tiff = buildTiff(spec);
    const input = jpegWith([app1ExifRaw(tiff)]);
    const { bytes } = strip(input);
    const [exif] = app(bytes, MARKERS.APP1);
    const out = payloadOf(bytes, exif!).subarray(6); // after Exif\0\0
    expect(out.length).toBe(tiff.length);

    const little = order === 'II';
    const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    expect(view(tiff).getUint16(8, little)).toBe(3); // Make, Model, GPSInfo
    expect(view(out).getUint16(8, little)).toBe(2);
    // entries 0 and 1 unchanged, the next-IFD pointer now where entry 2 was, then 12 zero bytes
    expect(Buffer.from(out.subarray(10, 34)).equals(Buffer.from(tiff.subarray(10, 34)))).toBe(true);
    expect(view(out).getUint32(34, little)).toBe(0);
    expect(Array.from(out.subarray(38, 50))).toEqual(new Array(12).fill(0));
    // the GPS IFD (table and values) is all zeros; everything before it is untouched apart from IFD0's table
    const gpsAt = view(tiff).getUint32(10 + 24 + 8, little);
    expect(out.subarray(gpsAt).every((b) => b === 0)).toBe(true);
    expect(Buffer.from(out.subarray(50, gpsAt)).equals(Buffer.from(tiff.subarray(50, gpsAt)))).toBe(true);
  });
});

describe('one fixture per dropped kind', () => {
  const keptExif = (extra: ExifSpec['ifd0'], exifExtra: ExifSpec['ifd0'] = []): ExifSpec => ({
    ifd0: [{ tag: 0x013b, type: 2, value: 'Ana Petrova' }, { tag: 0x8298, type: 2, value: '(c) Ana Petrova' }, ...extra],
    exif: [{ tag: 0x9003, type: 2, value: '2026:06:14 15:42:07' }, ...exifExtra],
  });
  const kinds: [string, Uint8Array, string | Uint8Array][] = [
    ['COM', jpegWith([app1Exif(keptExif([])), com()]), SECRETS.comment],
    ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15].map((n): [string, Uint8Array, string] => [`APP${n}`, jpegWith([app1Exif(keptExif([])), appN(n, `${SECRETS.vendor}-${n}`)]), `${SECRETS.vendor}-${n}`]),
    ['XMP', jpegWith([app1Exif(keptExif([])), app1Xmp()]), SECRETS.xmp],
    ['ExtendedXMP', jpegWith([app1Exif(keptExif([])), app1ExtendedXmp()]), SECRETS.extendedXmp],
    ['MPF', jpegWith([app1Exif(keptExif([])), app2Mpf()]), SECRETS.mpf],
    ['data after EOI', jpegWith([app1Exif(keptExif([]))], { trailing: segment(0xfe, new TextEncoder().encode('AFTER-EOI-Sofia')) }), 'AFTER-EOI-Sofia'],
    ['the IRB thumbnail (0x040C)', jpegWith([app1Exif(keptExif([])), app13([irbResource(0x0404, iptcDataset(2, 5, 'Name')), irbResource(0x040c, new TextEncoder().encode(SECRETS.irbThumb))])]), SECRETS.irbThumb],
    ['IPTC city', jpegWith([app1Exif(keptExif([])), app13([irbResource(0x0404, cameraIptc())])]), SECRETS.iptcCity],
    ['IPTC country', jpegWith([app1Exif(keptExif([])), app13([irbResource(0x0404, cameraIptc())])]), SECRETS.iptcCountry],
    ['ImageDescription', jpegWith([app1Exif(keptExif([{ tag: 0x010e, type: 2, value: SECRETS.description }]))]), SECRETS.description],
    ['UserComment', jpegWith([app1Exif(keptExif([], [{ tag: 0x9286, type: 7, value: new TextEncoder().encode(`ASCII\0\0\0${SECRETS.userComment}`) }]))]), SECRETS.userComment],
    ...(
      [
        [0x9c9b, 'XPTitle', SECRETS.xpTitle],
        [0x9c9c, 'XPComment', SECRETS.xpComment],
        [0x9c9d, 'XPAuthor', SECRETS.xpAuthor],
        [0x9c9e, 'XPKeywords', SECRETS.xpKeywords],
        [0x9c9f, 'XPSubject', SECRETS.xpSubject],
      ] as const
    ).map(([tag, name, text]): [string, Uint8Array, Uint8Array] => [name, jpegWith([app1Exif(keptExif([{ tag, type: 1, value: ucs2(text) }]))]), ucs2(text).subarray(0, -2)]),
    ['CameraOwnerName', jpegWith([app1Exif(keptExif([], [{ tag: 0xa430, type: 2, value: SECRETS.owner }]))]), SECRETS.owner],
    ['OwnerName (0xFDE8)', jpegWith([app1Exif(keptExif([], [{ tag: 0xfde8, type: 2, value: SECRETS.owner }]))]), SECRETS.owner],
    ['MakerNote', jpegWith([app1Exif(keptExif([], [{ tag: 0x927c, type: 7, value: new TextEncoder().encode(SECRETS.makerNote) }]))]), SECRETS.makerNote],
    ['XMP nested in a TIFF tag (0x02BC)', jpegWith([app1Exif(keptExif([{ tag: 0x02bc, type: 1, value: new TextEncoder().encode(SECRETS.xmp) }]))]), SECRETS.xmp],
  ];

  it.each(kinds)('%s is gone; Artist and Copyright stay', async (_, input, needle) => {
    expect(containsBytes(input, needle)).toBe(true);
    const { bytes } = strip(input);
    expect(containsBytes(bytes, needle)).toBe(false);
    const parsed = await parse(bytes);
    expectNoLocation(parsed);
    expect(parsed).toMatchObject({ ifd0: { Artist: 'Ana Petrova', Copyright: '(c) Ana Petrova' } });
    expect(scans(bytes)).toEqual(scans(input));
  });
});

describe('refused: a structure the editor does not know', () => {
  const subIfds: ExifSpec = { ifd0: [{ tag: 0x014a, type: 4, value: [8] }] };
  const gpsOutside = (() => {
    const tiff = buildTiff({ ifd0: [{ tag: 0x010f, type: 2, value: 'Canon' }], gps: cameraExif().gps });
    const view = new DataView(tiff.buffer);
    // GPSLatitude (3 rationals) points past the end of the segment
    const gpsAt = view.getUint32(8 + 2 + 12 + 8, true);
    view.setUint32(gpsAt + 2 + 2 * 12 + 8, tiff.length + 100, true);
    return tiff;
  })();
  const truncatedScan = base.jpeg().subarray(0, base.jpeg().length - 40);

  it.each([
    ['SubIFDs (0x014A)', jpegWith([app1Exif(subIfds)]), 'location'],
    ['a second EXIF segment', jpegWith([app1Exif(cameraExif()), app1Exif({ ifd0: [{ tag: 0x010f, type: 2, value: 'Canon' }] })]), 'location'],
    ['an unparsable IRB', jpegWith([segment(0xed, new TextEncoder().encode('Photoshop 3.0\0XXXX garbage'))]), 'location'],
    ['an IRB resource longer than its segment', jpegWith([segment(0xed, new Uint8Array([...new TextEncoder().encode('Photoshop 3.0\0'), ...new TextEncoder().encode('8BIM'), 4, 4, 0, 0, 0, 0, 0xff, 0xff]))]), 'location'],
    ['an extended-length IPTC dataset', jpegWith([app13([irbResource(0x0404, new Uint8Array([0x1c, 2, 90, 0x80, 0x04, 0, 0, 0, 4]))])]), 'location'],
    ['a GPS offset outside the segment', jpegWith([app1ExifRaw(gpsOutside)]), 'location'],
    ['an unparsable TIFF header', jpegWith([app1ExifRaw(new TextEncoder().encode('XX*\0\0\0\0\x08'))]), 'location'],
    ['IFD0 outside the segment', jpegWith([app1ExifRaw(new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0, 0, 0]))]), 'location'],
    ['truncated in the scan', truncatedScan, 'unreadable'],
    ['truncated in a segment', base.jpeg().subarray(0, 30), 'unreadable'],
    ['no EOI', base.jpeg().subarray(0, base.jpeg().length - 2), 'unreadable'],
    ['not a JPEG', base.png(), 'unreadable'],
  ] as const)('%s → %s', (_, input, reason) => {
    expect(stripMetadata(input, 'image/jpeg')).toMatchObject({ ok: false, reason });
  });
});
