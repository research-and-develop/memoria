import { base } from './base';

/**
 * Byte fixtures for the metadata editors (plan p05 T5.4), built in memory on real encoder output
 * (`base.ts`): a TIFF writer for EXIF in both byte orders, the JPEG segments a camera or an editor
 * writes (XMP, ExtendedXMP, MPF, IPTC, comments, vendor APPn, a secondary image after EOI) and PNG /
 * WebP metadata chunks. The tests check each fixture with `exifr` before trusting it, so the writer
 * cannot hide a mistake the editor shares. Test-only: nothing in the app imports this.
 */

export { base };

// ---------------------------------------------------------------- TIFF / EXIF

export type TiffTag =
  | { tag: number; type: 2; value: string }
  | { tag: number; type: 1 | 7; value: Uint8Array }
  | { tag: number; type: 3 | 4; value: number[] }
  | { tag: number; type: 5; value: [number, number][] };

export type ExifSpec = {
  order?: 'II' | 'MM';
  ifd0: TiffTag[];
  exif?: TiffTag[];
  interop?: TiffTag[];
  gps?: TiffTag[];
  ifd1?: { tags: TiffTag[]; thumbnail: Uint8Array };
};

const enc = (s: string) => new TextEncoder().encode(s);
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function valueBytes(t: TiffTag, little: boolean): { bytes: Uint8Array; count: number } {
  if (t.type === 2) {
    const bytes = concatBytes(enc(t.value), new Uint8Array([0]));
    return { bytes, count: bytes.length };
  }
  if (t.type === 1 || t.type === 7) return { bytes: t.value, count: t.value.length };
  const unit = t.type === 3 ? 2 : t.type === 4 ? 4 : 8;
  const bytes = new Uint8Array(unit * t.value.length);
  const view = new DataView(bytes.buffer);
  t.value.forEach((v, i) => {
    if (t.type === 3) view.setUint16(i * 2, v as number, little);
    else if (t.type === 4) view.setUint32(i * 4, v as number, little);
    else {
      view.setUint32(i * 8, (v as [number, number])[0], little);
      view.setUint32(i * 8 + 4, (v as [number, number])[1], little);
    }
  });
  return { bytes, count: t.value.length };
}

const pad2 = (n: number) => n + (n % 2);
const long = (tag: number, value = 0): TiffTag => ({ tag, type: 4, value: [value] });

/** A TIFF block (what follows `Exif\0\0`): IFD0, Exif, Interop, GPS, IFD1 and its thumbnail, in that order. */
export function buildTiff(spec: ExifSpec): Uint8Array {
  const little = (spec.order ?? 'II') === 'II';
  const ifd0 = [...spec.ifd0, ...(spec.exif ? [long(0x8769)] : []), ...(spec.gps ? [long(0x8825)] : [])];
  const exif = spec.exif ? [...spec.exif, ...(spec.interop ? [long(0xa005)] : [])] : null;
  const ifd1 = spec.ifd1 ? [...spec.ifd1.tags, long(0x0201), long(0x0202, spec.ifd1.thumbnail.length)] : null;
  const blocks: { name: string; tags: TiffTag[] }[] = [{ name: 'ifd0', tags: ifd0 }];
  if (exif) blocks.push({ name: 'exif', tags: exif });
  if (spec.interop) blocks.push({ name: 'interop', tags: spec.interop });
  if (spec.gps) blocks.push({ name: 'gps', tags: spec.gps });
  if (ifd1) blocks.push({ name: 'ifd1', tags: ifd1 });
  for (const b of blocks) b.tags.sort((x, y) => x.tag - y.tag);

  const size = (tags: TiffTag[]) => 2 + 12 * tags.length + 4 + tags.reduce((n, t) => n + (valueBytes(t, little).bytes.length > 4 ? pad2(valueBytes(t, little).bytes.length) : 0), 0);
  const offsets: Record<string, number> = {};
  let at = 8;
  for (const b of blocks) {
    offsets[b.name] = at;
    at += size(b.tags);
  }
  const thumbAt = at;
  const total = at + (spec.ifd1?.thumbnail.length ?? 0);
  const pointers: Record<number, number> = { 0x8769: offsets.exif ?? 0, 0x8825: offsets.gps ?? 0, 0xa005: offsets.interop ?? 0, 0x0201: thumbAt };

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(latin1(little ? 'II' : 'MM'), 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  for (const b of blocks) {
    const start = offsets[b.name] ?? 0;
    view.setUint16(start, b.tags.length, little);
    let valueAt = start + 2 + 12 * b.tags.length + 4;
    b.tags.forEach((t, i) => {
      const entry = start + 2 + 12 * i;
      const pointer = t.type === 4 && t.value.length === 1 && t.value[0] === 0 ? pointers[t.tag] : undefined;
      const { bytes, count } = valueBytes(pointer !== undefined ? long(t.tag, pointer) : t, little);
      view.setUint16(entry, t.tag, little);
      view.setUint16(entry + 2, t.type, little);
      view.setUint32(entry + 4, count, little);
      if (bytes.length <= 4) out.set(bytes, entry + 8);
      else {
        view.setUint32(entry + 8, valueAt, little);
        out.set(bytes, valueAt);
        valueAt += pad2(bytes.length);
      }
    });
    view.setUint32(start + 2 + 12 * b.tags.length, b.name === 'ifd0' && offsets.ifd1 ? offsets.ifd1 : 0, little);
  }
  if (spec.ifd1) out.set(spec.ifd1.thumbnail, thumbAt);
  return out;
}

/** UTF-16LE with a terminator, as Windows writes the XP tags. */
export const ucs2 = (s: string) => {
  const out = new Uint8Array((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) out[i * 2] = s.charCodeAt(i);
  return out;
};

/** Text a test can search for: where it shows up in an output, a location leaked. */
export const SECRETS = {
  description: 'Cafe on Elm Street, Sofia',
  userComment: 'At home 42 Elm Street',
  xpTitle: 'XPTITLE-Sofia',
  xpComment: 'XPCOMMENT-Sofia',
  xpAuthor: 'XPAUTHOR-Sofia',
  xpKeywords: 'XPKEYWORDS-Sofia',
  xpSubject: 'XPSUBJECT-Sofia',
  owner: 'OWNER-Ana-Home',
  makerNote: 'MAKERNOTE-GPS-42.69-23.32',
  xmp: 'XMP-CITY-Plovdiv',
  extendedXmp: 'EXTXMP-Varna',
  iptcCity: 'IPTC-CITY-Burgas',
  iptcSublocation: 'IPTC-SUBLOC-Ruse',
  iptcCountry: 'IPTC-COUNTRY-Bulgaria',
  comment: 'COM-Lozenets',
  vendor: 'APPN-VENDOR-Mladost',
  mpf: 'MPF-SECONDARY',
  irbThumb: 'IRB-THUMBNAIL',
} as const;

/** EXIF the way a camera writes it: everything the editor must remove, and what it must keep. */
export function cameraExif(opts: { order?: 'II' | 'MM'; orientation?: number } = {}): ExifSpec {
  return {
    order: opts.order ?? 'II',
    ifd0: [
      { tag: 0x010e, type: 2, value: SECRETS.description },
      { tag: 0x010f, type: 2, value: 'Canon' },
      { tag: 0x0110, type: 2, value: 'Canon EOS R5' },
      { tag: 0x0112, type: 3, value: [opts.orientation ?? 1] },
      { tag: 0x013b, type: 2, value: 'Ana Petrova' },
      { tag: 0x8298, type: 2, value: '(c) Ana Petrova' },
      { tag: 0x9c9b, type: 1, value: ucs2(SECRETS.xpTitle) },
      { tag: 0x9c9c, type: 1, value: ucs2(SECRETS.xpComment) },
      { tag: 0x9c9d, type: 1, value: ucs2(SECRETS.xpAuthor) },
      { tag: 0x9c9e, type: 1, value: ucs2(SECRETS.xpKeywords) },
      { tag: 0x9c9f, type: 1, value: ucs2(SECRETS.xpSubject) },
    ],
    exif: [
      { tag: 0x829a, type: 5, value: [[1, 250]] },
      { tag: 0x829d, type: 5, value: [[28, 10]] },
      { tag: 0x8827, type: 3, value: [400] },
      { tag: 0x9003, type: 2, value: '2026:06:14 15:42:07' },
      { tag: 0x920a, type: 5, value: [[50, 1]] },
      { tag: 0x927c, type: 7, value: enc(`${SECRETS.makerNote}\0\0\0\0\0\0\0\0`) },
      { tag: 0x9286, type: 7, value: concatBytes(latin1('ASCII\0\0\0'), enc(SECRETS.userComment)) },
      { tag: 0xa430, type: 2, value: SECRETS.owner },
      { tag: 0xa433, type: 2, value: 'Canon' },
      { tag: 0xa434, type: 2, value: 'RF50mm F1.2 L USM' },
    ],
    interop: [{ tag: 0x0001, type: 2, value: 'R98' }],
    gps: [
      { tag: 0x0000, type: 1, value: new Uint8Array([2, 3, 0, 0]) },
      { tag: 0x0001, type: 2, value: 'N' },
      { tag: 0x0002, type: 5, value: [[42, 1], [41, 1], [3012, 100]] },
      { tag: 0x0003, type: 2, value: 'E' },
      { tag: 0x0004, type: 5, value: [[23, 1], [19, 1], [1234, 100]] },
      { tag: 0x0006, type: 5, value: [[550, 1]] },
    ],
    ifd1: { tags: [{ tag: 0x0103, type: 3, value: [6] }], thumbnail: base.jpeg() },
  };
}

// ---------------------------------------------------------------- JPEG segments

export function segment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concatBytes(new Uint8Array([0xff, marker, length >> 8, length & 0xff]), payload);
}

export const app1Exif = (spec: ExifSpec) => segment(0xe1, concatBytes(latin1('Exif\0\0'), buildTiff(spec)));
export const app1ExifRaw = (tiff: Uint8Array) => segment(0xe1, concatBytes(latin1('Exif\0\0'), tiff));

export function app1Xmp(text: string = SECRETS.xmp): Uint8Array {
  const xml =
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" ` +
    `photoshop:City="${text}" exif:GPSLatitude="42,41.5N" exif:GPSLongitude="23,19.2E"/></rdf:RDF></x:xmpmeta>`;
  return segment(0xe1, concatBytes(latin1('http://ns.adobe.com/xap/1.0/\0'), enc(xml)));
}

export function app1ExtendedXmp(text: string = SECRETS.extendedXmp): Uint8Array {
  const data = enc(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><!-- ${text} --></x:xmpmeta>`);
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, data.length);
  return segment(0xe1, concatBytes(latin1('http://ns.adobe.com/xmp/extension/\0'), latin1('0123456789ABCDEF0123456789ABCDEF'), header, data));
}

export const app2Mpf = () => segment(0xe2, concatBytes(latin1('MPF\0'), latin1('MM\0*\0\0\0\x08'), enc(SECRETS.mpf)));
export const com = (text: string = SECRETS.comment) => segment(0xfe, enc(text));
export const appN = (n: number, text: string = SECRETS.vendor) => segment(0xe0 + n, concatBytes(latin1('Vendor\0'), enc(text)));

export function iptcDataset(record: number, dataset: number, value: string | Uint8Array): Uint8Array {
  const data = typeof value === 'string' ? enc(value) : value;
  return concatBytes(new Uint8Array([0x1c, record, dataset, data.length >> 8, data.length & 0xff]), data);
}

export function irbResource(id: number, data: Uint8Array, signature = '8BIM'): Uint8Array {
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, data.length);
  return concatBytes(latin1(signature), new Uint8Array([id >> 8, id & 0xff, 0, 0]), size, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array());
}

/** IPTC as Photo Mechanic or Lightroom write it: the four kept records, location records, and other resources. */
export function cameraIptc(): Uint8Array {
  return concatBytes(
    iptcDataset(2, 0, new Uint8Array([0, 4])),
    iptcDataset(2, 5, 'Wedding of M and J'),
    iptcDataset(2, 80, 'Ana Petrova'),
    iptcDataset(2, 90, SECRETS.iptcCity),
    iptcDataset(2, 92, SECRETS.iptcSublocation),
    iptcDataset(2, 95, 'IPTC-STATE'),
    iptcDataset(2, 101, SECRETS.iptcCountry),
    iptcDataset(2, 116, '(c) Ana Petrova'),
    iptcDataset(2, 120, 'First dance'),
  );
}

export function app13(resources: Uint8Array[] = [irbResource(0x0404, cameraIptc()), irbResource(0x040c, enc(SECRETS.irbThumb)), irbResource(0x0425, new Uint8Array(16))]): Uint8Array {
  return segment(0xed, concatBytes(latin1('Photoshop 3.0\0'), ...resources));
}

/** The base JPEG with `segments` inserted after APP0 (where cameras put them), plus bytes after EOI. */
export function jpegWith(segments: Uint8Array[], opts: { trailing?: Uint8Array } = {}): Uint8Array {
  const jpeg = base.jpeg();
  const app0End = 4 + ((jpeg[4]! << 8) | jpeg[5]!); // SOI (2) + APP0 marker (2) + its length
  return concatBytes(jpeg.subarray(0, app0End), ...segments, jpeg.subarray(app0End), opts.trailing ?? new Uint8Array());
}

/** Everything a camera, a phone and an editor might leave in one JPEG. */
export function cameraJpeg(opts: { order?: 'II' | 'MM'; orientation?: number } = {}): Uint8Array {
  return jpegWith(
    [app1Exif(cameraExif(opts)), app1Xmp(), app1ExtendedXmp(), app2Mpf(), app13(), com(), ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15].map((n) => appN(n))],
    { trailing: base.jpeg() },
  );
}

// ---------------------------------------------------------------- PNG / WebP

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  view.setUint32(0, data.length);
  head.set(latin1(type), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concatBytes(latin1(type), data)));
  return concatBytes(head, data, crc);
}

/** The base PNG with `chunks` inserted after IHDR. */
export function pngWith(chunks: Uint8Array[]): Uint8Array {
  const png = base.png();
  const ihdrEnd = 8 + 12 + 13;
  return concatBytes(png.subarray(0, ihdrEnd), ...chunks, png.subarray(ihdrEnd));
}

export const pngText = (keyword: string, text: string) => pngChunk('tEXt', concatBytes(latin1(keyword), new Uint8Array([0]), latin1(text)));

export function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(latin1(fourcc), 0);
  new DataView(head.buffer).setUint32(4, data.length, true);
  return concatBytes(head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array());
}

/** The chunks of a WebP, as `[fourcc, data]`. */
export function webpChunksOf(webp: Uint8Array): [string, Uint8Array][] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const out: [string, Uint8Array][] = [];
  for (let pos = 12; pos + 8 <= webp.length; ) {
    const size = view.getUint32(pos + 4, true);
    out.push([String.fromCharCode(...webp.subarray(pos, pos + 4)), webp.subarray(pos + 8, pos + 8 + size)]);
    pos += 8 + size + (size % 2);
  }
  return out;
}

export function riffWebp(chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(latin1('WEBP'), ...chunks);
  const head = new Uint8Array(8);
  head.set(latin1('RIFF'), 0);
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concatBytes(head, body);
}

/** The simple formats: the bare image chunk of a base WebP (`VP8 ` lossy, `VP8L` lossless). */
export function simpleWebp(kind: 'lossy' | 'lossless'): Uint8Array {
  const chunks = webpChunksOf(kind === 'lossy' ? base.webpLossy() : base.webpLossless());
  const [fourcc, data] = chunks.find(([c]) => c === 'VP8 ' || c === 'VP8L')!;
  return riffWebp([webpChunk(fourcc, data)]);
}

/** The extended lossy base with metadata chunks appended and their VP8X flags set (EXIF 0x08, XMP 0x04). */
export function webpWith(extra: { exif?: Uint8Array; xmp?: string }): Uint8Array {
  const chunks = webpChunksOf(base.webpLossy()).map(([c, d]) => [c, d.slice()] as [string, Uint8Array]);
  const vp8x = chunks.find(([c]) => c === 'VP8X')![1];
  vp8x[0] = (vp8x[0] ?? 0) | (extra.exif ? 0x08 : 0) | (extra.xmp ? 0x04 : 0);
  const out = chunks.map(([c, d]) => webpChunk(c, d));
  if (extra.exif) out.push(webpChunk('EXIF', extra.exif));
  if (extra.xmp) out.push(webpChunk('XMP ', enc(extra.xmp)));
  return riffWebp(out);
}

/** Whether `needle` (text as UTF-8, or raw bytes) occurs anywhere in `haystack`. */
export function containsBytes(haystack: Uint8Array, needle: string | Uint8Array): boolean {
  const n = typeof needle === 'string' ? enc(needle) : needle;
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}
