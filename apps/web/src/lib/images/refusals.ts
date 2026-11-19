import type { RefusalReason } from './metadata/refusal';
import type { UnsupportedKind } from './sniff';

/**
 * Why a dropped file is not uploaded, and what the upload panel says about it (plan p05: "other
 * files listed as not supported with the reason"). Pure; shared by the probe, the worker and the UI.
 */
export type FileRefusal =
  | { code: 'unsupported'; kind: UnsupportedKind }
  | { code: 'too-large' }
  | { code: 'too-many-pixels' }
  | { code: RefusalReason }
  | { code: 'decode' };

export type RefusalCode = FileRefusal['code'];

const UNSUPPORTED: Record<UnsupportedKind, string> = {
  heic: 'HEIC photos are not supported. Export them as JPEG.',
  tiff: 'TIFF files are not supported. Export them as JPEG.',
  raw: 'RAW files are not supported. Export JPEGs from your editor.',
  gif: 'GIFs are not supported.',
  video: 'Videos are not supported.',
  other: 'Not a JPEG, PNG or WebP image.',
};

export function refusalMessage(refusal: FileRefusal): string {
  switch (refusal.code) {
    case 'unsupported':
      return UNSUPPORTED[refusal.kind];
    case 'too-large':
      return 'Larger than 100 MB.';
    case 'too-many-pixels':
      return 'Larger than 100 megapixels.';
    case 'location':
      return 'The location data in this file cannot be removed. Export it again as JPEG.';
    case 'metadata':
      return 'This file carries metadata that cannot be removed yet. Export it as JPEG, or without metadata.';
    case 'unreadable':
      return 'The file is damaged or incomplete.';
    case 'decode':
      return 'This browser could not open the image.';
  }
}
