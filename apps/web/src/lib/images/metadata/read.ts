import { TAGS, Tiff, type Ifd } from './tiff';

/**
 * What the upload keeps from a photo's EXIF (plan p05 D5.6): the orientation, the capture time
 * (`photos.taken_at`, D5.23) and the camera details stored in `photos.meta`. Read from the cleaned
 * TIFF; lenient: a value that is missing or malformed is simply absent.
 */

/** `photos.meta` (≤ 2048 characters of JSON): only the fields present. */
export type PhotoMeta = {
  camera?: string;
  lens?: string;
  /** mm */
  focal?: number;
  /** f-number */
  aperture?: number;
  /** "1/250" or "2" (seconds) */
  shutter?: string;
  iso?: number;
};

export type ExifInfo = {
  /** EXIF orientation 1–8 (1 when absent or invalid). */
  orientation: number;
  /** `YYYY-MM-DDTHH:MM:SS`, the camera's wall clock (no zone), or null. */
  takenAt: string | null;
  meta: PhotoMeta;
};

export const NO_EXIF: ExifInfo = { orientation: 1, takenAt: null, meta: {} };

const MAX_TEXT = 64;
/** Control and bidi/format characters never reach the database. */
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/gu;

export function readExif(tiffBytes: Uint8Array): ExifInfo {
  const tiff = new Tiff(tiffBytes);
  const ifd0 = tiff.ifd(tiff.firstIfd, 'IFD0');
  const exifAt = tiff.pointer(ifd0, TAGS.exifIfd);
  const exif: Ifd | null = exifAt !== null ? tiff.ifd(exifAt, 'Exif IFD') : null;
  const fromExif = (tag: number) => (exif ? tiff.entry(exif, tag) : undefined);

  const orientation = tiff.integers(tiff.entry(ifd0, TAGS.orientation))[0];
  const meta: PhotoMeta = {};
  const camera = cameraName(clean(tiff.text(tiff.entry(ifd0, TAGS.make))), clean(tiff.text(tiff.entry(ifd0, TAGS.model))));
  if (camera) meta.camera = camera;
  const lens = cameraName(clean(tiff.text(fromExif(TAGS.lensMake))), clean(tiff.text(fromExif(TAGS.lensModel))));
  if (lens) meta.lens = lens;
  const focal = tiff.rational(fromExif(TAGS.focalLength));
  if (focal !== null && focal > 0 && focal < 10_000) meta.focal = round(focal, 1);
  const aperture = tiff.rational(fromExif(TAGS.fNumber));
  if (aperture !== null && aperture > 0 && aperture < 1000) meta.aperture = round(aperture, 1);
  const exposure = tiff.rational(fromExif(TAGS.exposureTime));
  if (exposure !== null && exposure > 0 && exposure < 100_000) meta.shutter = shutter(exposure);
  const iso = tiff.integers(fromExif(TAGS.iso))[0];
  if (iso !== undefined && iso > 0) meta.iso = iso;

  return {
    orientation: orientation !== undefined && orientation >= 1 && orientation <= 8 ? orientation : 1,
    takenAt: exifDate(tiff.text(fromExif(TAGS.dateTimeOriginal))),
    meta,
  };
}

/** EXIF's `YYYY:MM:DD HH:MM:SS` → `YYYY-MM-DDTHH:MM:SS`; null for blanks, zeros and impossible dates. */
export function exifDate(value: string | null): string | null {
  const m = value?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  if (y < 1800 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** "Canon" + "Canon EOS R5" → "Canon EOS R5"; "SONY" + "ILCE-7M4" → "SONY ILCE-7M4". */
export function cameraName(make: string | null, model: string | null): string | null {
  if (!model) return make;
  if (!make) return model;
  const firstWord = make.split(/\s+/)[0]?.toLowerCase() ?? '';
  return (model.toLowerCase().startsWith(firstWord) ? model : `${make} ${model}`).slice(0, MAX_TEXT);
}

/** 0.004 → "1/250", 0.5 → "1/2", 2 → "2", 1.3 → "1.3". */
export function shutter(seconds: number): string {
  if (seconds < 1) return `1/${Math.round(1 / seconds)}`;
  return String(round(seconds, 1));
}

function clean(value: string | null): string | null {
  const text = value?.replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return text || null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
