import { ascii, concat } from './bytes';
import { refuse } from './refusal';

/**
 * A JPEG's APP13 ("Photoshop 3.0" image resource blocks) rebuilt from a whitelist (plan p05 D5.6):
 * only the IPTC resource (0x0404), holding only records 2:00 (the record version, structural),
 * 2:05 object name, 2:80 by-line, 2:116 copyright and 2:120 caption. Every other resource (the 0x040C
 * thumbnail, the 0x0425 digest, which no longer matches) and every other IPTC dataset (city,
 * sub-location, state, country, keywords…) is dropped. A block this parser cannot read refuses the file.
 */

export const PHOTOSHOP_ID = 'Photoshop 3.0\0';
const IRB_SIGNATURES = new Set(['8BIM', 'PHUT', 'AgHg', 'DCSR', 'MeSa']);
const IPTC_RESOURCE = 0x0404;
/** `record:dataset` pairs kept. */
export const KEPT_IPTC: ReadonlySet<string> = new Set(['2:0', '2:5', '2:80', '2:116', '2:120']);

const u16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u32 = (bytes: Uint8Array, at: number) => (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0;
const allZero = (bytes: Uint8Array, from: number) => bytes.subarray(from).every((b) => b === 0);

/**
 * The APP13 payload (after the length) rebuilt, or null when nothing is left to keep.
 * Throws `MetadataRefusal('location')` for a block it cannot parse.
 */
export function rebuildApp13(payload: Uint8Array): Uint8Array | null {
  if (ascii(payload, 0, PHOTOSHOP_ID.length) !== PHOTOSHOP_ID) refuse('location', 'APP13 without the Photoshop 3.0 header');
  const kept: Uint8Array[] = [];
  let pos = PHOTOSHOP_ID.length;
  while (pos < payload.length) {
    if (pos + 4 > payload.length || !IRB_SIGNATURES.has(ascii(payload, pos, 4))) {
      if (allZero(payload, pos)) break; // padding
      refuse('location', 'unparsable image resource block');
    }
    const signature = ascii(payload, pos, 4);
    const id = u16(payload, pos + 4);
    const nameLength = payload[pos + 6];
    if (nameLength === undefined) return refuse('location', 'truncated image resource block');
    const nameSize = (1 + nameLength) % 2 === 0 ? 1 + nameLength : 2 + nameLength;
    const sizeAt = pos + 6 + nameSize;
    if (sizeAt + 4 > payload.length) refuse('location', 'truncated image resource block');
    const size = u32(payload, sizeAt);
    const dataAt = sizeAt + 4;
    if (dataAt + size > payload.length) refuse('location', 'image resource outside the segment');
    if (signature === '8BIM' && id === IPTC_RESOURCE) {
      const iptc = filterIptc(payload.subarray(dataAt, dataAt + size));
      if (iptc.length > 0) kept.push(iptc);
    }
    pos = dataAt + size + (size % 2);
  }
  if (kept.length === 0) return null;

  const data = concat(kept);
  const header = new TextEncoder().encode(PHOTOSHOP_ID);
  const resource = new Uint8Array(4 + 2 + 2 + 4 + data.length + (data.length % 2));
  resource.set(new TextEncoder().encode('8BIM'), 0);
  resource.set([IPTC_RESOURCE >> 8, IPTC_RESOURCE & 0xff, 0, 0], 4); // id, empty name padded to even
  resource.set([(data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff], 8);
  resource.set(data, 12);
  return concat([header, resource]);
}

/** The IPTC-IIM datasets of `KEPT_IPTC`, in their order. */
export function filterIptc(data: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [];
  let pos = 0;
  while (pos < data.length) {
    if (data[pos] !== 0x1c) {
      if (allZero(data, pos)) break;
      refuse('location', 'unparsable IPTC dataset');
    }
    if (pos + 5 > data.length) refuse('location', 'truncated IPTC dataset');
    const record = data[pos + 1] ?? 0;
    const dataset = data[pos + 2] ?? 0;
    const length = u16(data, pos + 3);
    if (length & 0x8000) refuse('location', 'extended IPTC dataset');
    const end = pos + 5 + length;
    if (end > data.length) refuse('location', 'IPTC dataset outside the resource');
    if (KEPT_IPTC.has(`${record}:${dataset}`)) kept.push(data.subarray(pos, end));
    pos = end;
  }
  return concat(kept);
}
