import { concat, startsWith } from './bytes';
import { PHOTOSHOP_ID, rebuildApp13 } from './iptc';
import { refuse } from './refusal';
import { cleanTiff } from './tiff';

/**
 * A JPEG rebuilt from a segment allow-list (plan p05 D5.6), its pixels untouched:
 * SOI, APP0 (JFIF), APP1 Exif (cleaned by `cleanTiff`), APP2 `ICC_PROFILE`, APP13 (rebuilt by
 * `rebuildApp13`), APP14 (Adobe), DQT, DHT, DAC, SOFn, DRI, DNL, SOS with its entropy-coded data, RSTn,
 * EOI. Everything else is dropped: COM, APP3–APP12, APP15, XMP, ExtendedXMP, MPF, FlashPix, JFXX, and
 * anything after the first EOI (secondary images). DAC and DNL carry no metadata (decoding tables
 * of arithmetic-coded and height-in-trailer files) and are kept so those files still decode.
 *
 * A second EXIF segment refuses the file (`location`); broken structure refuses it (`unreadable`).
 */

export const MARKERS = {
  SOI: 0xd8,
  EOI: 0xd9,
  SOS: 0xda,
  DQT: 0xdb,
  DNL: 0xdc,
  DRI: 0xdd,
  DHT: 0xc4,
  DAC: 0xcc,
  APP0: 0xe0,
  APP1: 0xe1,
  APP2: 0xe2,
  APP13: 0xed,
  APP14: 0xee,
  COM: 0xfe,
} as const;

export const EXIF_ID = 'Exif\0\0';
export const ICC_ID = 'ICC_PROFILE\0';
const JFIF_ID = 'JFIF\0';
const ADOBE_ID = 'Adobe';

/** One segment: `[start, end)` covers the marker, the length and the payload (and a scan's data). */
export type Segment = { marker: number; start: number; end: number };

export const isSof = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== MARKERS.DHT && marker !== 0xc8 && marker !== MARKERS.DAC;
const isRst = (marker: number) => marker >= 0xd0 && marker <= 0xd7;
const hasLength = (marker: number) => !(marker === MARKERS.SOI || marker === MARKERS.EOI || isRst(marker) || marker === 0x01);

/** The segments from SOI to the first EOI. Throws `MetadataRefusal('unreadable')` on broken structure. */
export function parseJpeg(bytes: Uint8Array): Segment[] {
  if (bytes[0] !== 0xff || bytes[1] !== MARKERS.SOI) refuse('unreadable', 'no SOI');
  const segments: Segment[] = [{ marker: MARKERS.SOI, start: 0, end: 2 }];
  let pos = 2;
  for (;;) {
    if (pos + 1 >= bytes.length) return refuse('unreadable', 'truncated before EOI');
    if (bytes[pos] !== 0xff) return refuse('unreadable', `no marker at ${pos}`);
    while (bytes[pos + 1] === 0xff) pos++; // fill bytes
    const marker = bytes[pos + 1];
    if (marker === undefined) return refuse('unreadable', 'truncated before EOI');
    if (marker === MARKERS.SOI) return refuse('unreadable', 'a second SOI');
    if (marker === MARKERS.EOI) {
      segments.push({ marker, start: pos, end: pos + 2 });
      return segments;
    }
    if (!hasLength(marker)) {
      segments.push({ marker, start: pos, end: pos + 2 });
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) return refuse('unreadable', 'truncated segment header');
    const length = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0);
    let end = pos + 2 + length;
    if (length < 2 || end > bytes.length) return refuse('unreadable', `segment 0x${marker.toString(16)} outside the file`);
    if (marker === MARKERS.SOS) end = scanEnd(bytes, end);
    segments.push({ marker, start: pos, end });
    pos = end;
  }
}

/** Where a scan's entropy-coded data ends: the first marker that is not a stuffed 0x00 or an RSTn. */
function scanEnd(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length - 1; i++) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1] ?? 0;
    if (next === 0x00 || isRst(next) || next === 0xff) continue;
    return i;
  }
  return refuse('unreadable', 'truncated scan');
}

/** The payload of a segment with a length (after the 4 marker/length bytes). */
export const payloadOf = (bytes: Uint8Array, segment: Segment): Uint8Array => bytes.subarray(segment.start + 4, segment.end);

function withPayload(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  if (length > 0xffff) refuse('location', 'rebuilt segment too long');
  return concat([new Uint8Array([0xff, marker, length >> 8, length & 0xff]), payload]);
}

export type CleanJpeg = { bytes: Uint8Array; exif: Uint8Array | null; width: number; height: number };

/**
 * The JPEG rebuilt from the allow-list; `exif` = the cleaned TIFF block (for `readExif`), and the
 * frame's stored (unrotated) size.
 */
export function cleanJpeg(bytes: Uint8Array): CleanJpeg {
  const segments = parseJpeg(bytes);
  const parts: Uint8Array[] = [];
  let exif: Uint8Array | null = null;
  let size: { width: number; height: number } | null = null;
  let scans = 0;

  for (const segment of segments) {
    const { marker } = segment;
    const raw = bytes.subarray(segment.start, segment.end);
    const payload = hasLength(marker) ? payloadOf(bytes, segment) : new Uint8Array();
    if (marker === MARKERS.APP1 && startsWith(payload, EXIF_ID)) {
      if (exif) refuse('location', 'a second EXIF segment');
      exif = cleanTiff(payload.subarray(EXIF_ID.length));
      parts.push(withPayload(MARKERS.APP1, concat([payload.subarray(0, EXIF_ID.length), exif])));
    } else if (marker === MARKERS.APP13) {
      if (!startsWith(payload, PHOTOSHOP_ID)) continue;
      const rebuilt = rebuildApp13(payload);
      if (rebuilt) parts.push(withPayload(MARKERS.APP13, rebuilt));
    } else if (keeps(marker, payload)) {
      if (isSof(marker)) size = frameSize(payload);
      if (marker === MARKERS.SOS) scans++;
      parts.push(raw);
    }
  }
  if (!size || scans === 0) refuse('unreadable', 'no frame or no scan');
  return { bytes: concat(parts), exif, ...(size as { width: number; height: number }) };
}

/** The allow-list, for every segment that is kept as it is. */
function keeps(marker: number, payload: Uint8Array): boolean {
  if (marker === MARKERS.APP0) return startsWith(payload, JFIF_ID);
  if (marker === MARKERS.APP2) return startsWith(payload, ICC_ID);
  if (marker === MARKERS.APP14) return startsWith(payload, ADOBE_ID);
  if (marker >= 0xe0 && marker <= 0xef) return false; // every other APPn
  return (
    marker === MARKERS.SOI ||
    marker === MARKERS.EOI ||
    marker === MARKERS.SOS ||
    marker === MARKERS.DQT ||
    marker === MARKERS.DHT ||
    marker === MARKERS.DAC ||
    marker === MARKERS.DRI ||
    marker === MARKERS.DNL ||
    isRst(marker) ||
    isSof(marker)
  );
}

/** SOFn payload: precision, height, width. Height 0 (defined later by DNL) is refused. */
function frameSize(payload: Uint8Array): { width: number; height: number } {
  const height = ((payload[1] ?? 0) << 8) | (payload[2] ?? 0);
  const width = ((payload[3] ?? 0) << 8) | (payload[4] ?? 0);
  if (payload.length < 5 || width === 0 || height === 0) refuse('unreadable', 'frame without a size');
  return { width, height };
}

/**
 * The frame size from the first bytes of a JPEG (no scan needed): null when the bytes end before the
 * frame header or the structure is broken. For the decode budget, before any decoding.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== MARKERS.SOI) return null;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    while (bytes[pos + 1] === 0xff) pos++;
    const marker = bytes[pos + 1] ?? 0;
    if (!hasLength(marker)) {
      pos += 2;
      continue;
    }
    const length = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0);
    if (isSof(marker)) {
      if (pos + 9 > bytes.length) return null;
      const height = ((bytes[pos + 5] ?? 0) << 8) | (bytes[pos + 6] ?? 0);
      const width = ((bytes[pos + 7] ?? 0) << 8) | (bytes[pos + 8] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === MARKERS.SOS || length < 2) return null;
    pos += 2 + length;
  }
  return null;
}
