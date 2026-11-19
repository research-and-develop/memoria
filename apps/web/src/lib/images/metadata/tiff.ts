import { refuse } from './refusal';

/**
 * The TIFF structure inside a JPEG's EXIF segment (plan p05 D5.6): a reader, and the cleaner that
 * removes location data without moving anything.
 *
 * Every value offset in a TIFF is absolute (from the TIFF header), so an entry can be removed from an
 * IFD by shifting the later entries up 12 bytes, moving the next-IFD pointer up and zeroing the freed
 * bytes: no other offset changes and the segment keeps its length. What is removed:
 * - the GPS IFD: its entries and values zeroed, its pointer (0x8825) removed;
 * - IFD1 (the embedded thumbnail, which can carry its own EXIF): unlinked and zeroed with its image;
 * - the tags in `REMOVED_TAGS` (MakerNote, the free-text tags phone and camera apps fill with place
 *   names, and metadata containers nested in a tag), from IFD0, the Exif IFD and the Interop IFD.
 * Anything the cleaner does not know how to follow (SubIFDs, an unknown value type on a removed tag,
 * an offset outside the segment) refuses the file.
 */

export const TAGS = {
  imageDescription: 0x010e,
  make: 0x010f,
  model: 0x0110,
  stripOffsets: 0x0111,
  orientation: 0x0112,
  stripByteCounts: 0x0117,
  subIfds: 0x014a,
  thumbnailOffset: 0x0201,
  thumbnailLength: 0x0202,
  artist: 0x013b,
  copyright: 0x8298,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  focalLength: 0x920a,
  makerNote: 0x927c,
  userComment: 0x9286,
  interopIfd: 0xa005,
  cameraOwnerName: 0xa430,
  lensMake: 0xa433,
  lensModel: 0xa434,
} as const;

/** Tags dropped wherever they appear in a kept IFD. */
export const REMOVED_TAGS: ReadonlySet<number> = new Set([
  TAGS.gpsIfd,
  TAGS.makerNote,
  TAGS.imageDescription,
  TAGS.userComment,
  0x9c9b, // XPTitle
  0x9c9c, // XPComment
  0x9c9d, // XPAuthor
  0x9c9e, // XPKeywords
  0x9c9f, // XPSubject
  TAGS.cameraOwnerName,
  0xfde8, // OwnerName (Photoshop Camera Raw)
  0x02bc, // XMP nested in a tag
  0x83bb, // IPTC-NAA nested in a tag
  0x8649, // Photoshop resources nested in a tag
]);

/** Bytes per value of each TIFF type (6.0 + the IFD type 13). */
const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

export type IfdEntry = {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the 12-byte entry. */
  at: number;
  /** Absolute offset of the value: inside the entry when it fits in 4 bytes. */
  valueAt: number;
  /** The value's size in bytes; null for a type this reader does not know. */
  size: number | null;
};
export type Ifd = { at: number; entries: IfdEntry[]; next: number };
type Range = { at: number; size: number };

export class Tiff {
  readonly view: DataView;
  readonly little: boolean;
  readonly firstIfd: number;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = bytes.length >= 8 ? String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0) : '';
    if (order !== 'II' && order !== 'MM') refuse('location', 'unparsable TIFF header');
    this.little = order === 'II';
    if (this.u16(2) !== 42) refuse('location', 'unparsable TIFF header');
    this.firstIfd = this.u32(4);
  }

  get length(): number {
    return this.bytes.length;
  }
  u16(at: number): number {
    return this.view.getUint16(at, this.little);
  }
  u32(at: number): number {
    return this.view.getUint32(at, this.little);
  }
  setU16(at: number, value: number): void {
    this.view.setUint16(at, value, this.little);
  }
  setU32(at: number, value: number): void {
    this.view.setUint32(at, value, this.little);
  }

  /** Refuse unless `[at, at + size)` lies inside the TIFF. */
  check(at: number, size: number, what: string): void {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || at + size > this.length) refuse('location', `${what} outside the segment`);
  }

  ifd(at: number, what: string): Ifd {
    if (at < 8) refuse('location', `${what} offset ${at}`);
    this.check(at, 2, what);
    const count = this.u16(at);
    this.check(at, 2 + 12 * count + 4, what);
    const entries: IfdEntry[] = [];
    for (let i = 0; i < count; i++) {
      const entryAt = at + 2 + 12 * i;
      const type = this.u16(entryAt + 2);
      const n = this.u32(entryAt + 4);
      const unit = TYPE_SIZES[type];
      const size = unit === undefined ? null : unit * n;
      entries.push({ tag: this.u16(entryAt), type, count: n, at: entryAt, valueAt: size !== null && size <= 4 ? entryAt + 8 : this.u32(entryAt + 8), size });
    }
    return { at, entries, next: this.u32(at + 2 + 12 * count) };
  }

  entry(ifd: Ifd, tag: number): IfdEntry | undefined {
    return ifd.entries.find((e) => e.tag === tag);
  }

  /** The offset an IFD pointer tag holds, or null when the IFD has no such tag. */
  pointer(ifd: Ifd, tag: number): number | null {
    const entry = this.entry(ifd, tag);
    if (!entry) return null;
    if ((entry.type !== 4 && entry.type !== 13) || entry.count !== 1) refuse('location', `pointer 0x${tag.toString(16)} of type ${entry.type}`);
    return this.u32(entry.valueAt);
  }

  /** Unsigned integer values (BYTE, SHORT, LONG); empty when out of bounds or another type. */
  integers(entry: IfdEntry | undefined): number[] {
    if (!entry || entry.size === null || entry.valueAt + entry.size > this.length) return [];
    const read = entry.type === 1 ? (at: number) => this.bytes[at] ?? 0 : entry.type === 3 ? (at: number) => this.u16(at) : entry.type === 4 ? (at: number) => this.u32(at) : null;
    if (!read) return [];
    const unit = TYPE_SIZES[entry.type] ?? 1;
    return Array.from({ length: Math.min(entry.count, 1024) }, (_, i) => read(entry.valueAt + i * unit));
  }

  /** The first RATIONAL / SRATIONAL value as a number; null when absent, zero-denominator or out of bounds. */
  rational(entry: IfdEntry | undefined): number | null {
    if (!entry || (entry.type !== 5 && entry.type !== 10) || entry.count < 1 || entry.valueAt + 8 > this.length) return null;
    const num = entry.type === 5 ? this.u32(entry.valueAt) : this.view.getInt32(entry.valueAt, this.little);
    const den = entry.type === 5 ? this.u32(entry.valueAt + 4) : this.view.getInt32(entry.valueAt + 4, this.little);
    return den === 0 ? null : num / den;
  }

  /** An ASCII value up to its first NUL, trimmed; null when absent, empty or out of bounds. */
  text(entry: IfdEntry | undefined): string | null {
    if (!entry || entry.type !== 2 || entry.size === null || entry.valueAt + entry.size > this.length) return null;
    const raw = this.bytes.subarray(entry.valueAt, entry.valueAt + entry.size);
    const end = raw.indexOf(0);
    const value = new TextDecoder('utf-8').decode(end === -1 ? raw : raw.subarray(0, end)).trim();
    return value || null;
  }
}

/** The IFDs a JPEG's EXIF keeps (IFD0, Exif, Interop) and the ones it drops (GPS, IFD1). */
type Layout = { kept: Ifd[]; gps: Ifd[]; ifd1: Ifd | null };

function layout(tiff: Tiff): Layout {
  const ifd0 = tiff.ifd(tiff.firstIfd, 'IFD0');
  const kept = [ifd0];
  const exifAt = tiff.pointer(ifd0, TAGS.exifIfd);
  if (exifAt !== null) {
    const exif = tiff.ifd(exifAt, 'Exif IFD');
    kept.push(exif);
    const interopAt = tiff.pointer(exif, TAGS.interopIfd);
    if (interopAt !== null) kept.push(tiff.ifd(interopAt, 'Interop IFD'));
  }
  for (const ifd of kept) if (tiff.entry(ifd, TAGS.subIfds)) refuse('location', 'SubIFDs');
  const gps: Ifd[] = [];
  for (const ifd of kept) {
    const gpsAt = tiff.pointer(ifd, TAGS.gpsIfd);
    if (gpsAt !== null) gps.push(tiff.ifd(gpsAt, 'GPS IFD'));
  }
  return { kept, gps, ifd1: ifd0.next !== 0 ? tiff.ifd(ifd0.next, 'IFD1') : null };
}

/** The out-of-line bytes of an entry (null when the value sits inside the entry); bounds-checked. */
function valueRange(tiff: Tiff, entry: IfdEntry, what: string): Range | null {
  if (entry.size === null) return refuse('location', `${what}: tag 0x${entry.tag.toString(16)} has unknown type ${entry.type}`);
  if (entry.size <= 4) return null;
  tiff.check(entry.valueAt, entry.size, what);
  return { at: entry.valueAt, size: entry.size };
}

/** Everything an IFD occupies: its table and its out-of-line values. */
function ifdRanges(tiff: Tiff, ifd: Ifd, what: string): Range[] {
  const ranges: Range[] = [{ at: ifd.at, size: 2 + 12 * ifd.entries.length + 4 }];
  for (const entry of ifd.entries) {
    const range = valueRange(tiff, entry, what);
    if (range) ranges.push(range);
  }
  return ranges;
}

/** The embedded thumbnail's image bytes: a JPEG (offset + length) or strips. */
function thumbnailRanges(tiff: Tiff, ifd1: Ifd): Range[] {
  const ranges: Range[] = [];
  const offset = tiff.integers(tiff.entry(ifd1, TAGS.thumbnailOffset))[0];
  const length = tiff.integers(tiff.entry(ifd1, TAGS.thumbnailLength))[0];
  if (offset !== undefined && length !== undefined) ranges.push({ at: offset, size: length });
  const strips = tiff.integers(tiff.entry(ifd1, TAGS.stripOffsets));
  const counts = tiff.integers(tiff.entry(ifd1, TAGS.stripByteCounts));
  strips.forEach((at, i) => ranges.push({ at, size: counts[i] ?? 0 }));
  for (const range of ranges) tiff.check(range.at, range.size, 'IFD1 thumbnail');
  return ranges;
}

/**
 * A copy of `input` (a TIFF block) with the GPS IFD, IFD1 and `REMOVED_TAGS` gone, same length.
 * Throws `MetadataRefusal('location')` for a structure it cannot clean.
 */
export function cleanTiff(input: Uint8Array): Uint8Array {
  const source = new Tiff(input);
  const { kept, gps, ifd1 } = layout(source);

  const zero: Range[] = [];
  for (const ifd of gps) zero.push(...ifdRanges(source, ifd, 'GPS IFD'));
  if (ifd1) zero.push(...ifdRanges(source, ifd1, 'IFD1'), ...thumbnailRanges(source, ifd1));
  for (const ifd of kept) {
    for (const entry of ifd.entries) {
      if (!REMOVED_TAGS.has(entry.tag)) continue;
      const range = valueRange(source, entry, `tag 0x${entry.tag.toString(16)}`);
      if (range) zero.push(range);
    }
  }

  const out = input.slice();
  const target = new Tiff(out);
  for (const { at, size } of zero) out.fill(0, at, at + size);
  // Rewrite each kept IFD from the source's entries, so zeroing can never damage a kept table.
  for (const ifd of kept) {
    const keep = ifd.entries.filter((e) => !REMOVED_TAGS.has(e.tag));
    const oldEnd = ifd.at + 2 + 12 * ifd.entries.length + 4;
    target.setU16(ifd.at, keep.length);
    keep.forEach((entry, i) => out.set(input.subarray(entry.at, entry.at + 12), ifd.at + 2 + 12 * i));
    const nextAt = ifd.at + 2 + 12 * keep.length;
    target.setU32(nextAt, 0); // IFD1 unlinked; the Exif and Interop IFDs never chain
    out.fill(0, nextAt + 4, oldEnd);
  }
  return out;
}
