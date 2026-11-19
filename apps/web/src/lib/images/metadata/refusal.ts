/**
 * Why a file is refused by the metadata step (plan p05 D5.6):
 * - `location`: a structure the editor does not know, so it cannot promise the location is gone
 *   (SubIFDs, a second EXIF segment, an unparsable IRB or TIFF, an offset outside its segment);
 * - `metadata`: a PNG or WebP carrying EXIF, XMP or text chunks (their editors come in M4);
 * - `unreadable`: the file itself is broken (truncated, no image data).
 *
 * Thrown inside the editors and caught by `stripMetadata`; `detail` is for logs and tests, never shown.
 */
export type RefusalReason = 'location' | 'metadata' | 'unreadable';

export class MetadataRefusal extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'MetadataRefusal';
  }
}

export const refuse = (reason: RefusalReason, detail: string): never => {
  throw new MetadataRefusal(reason, detail);
};
