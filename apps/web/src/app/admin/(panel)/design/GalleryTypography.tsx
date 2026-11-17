import { PAIRINGS, FAMILIES, pairingCovers } from '@repo/ui/theme/galleryFonts';
import { Caption, Display, Text } from '@repo/ui/typography';

import { GALLERY_FONT_CLASSES } from '../../../galleryFonts';

const LATIN = 'Maria & Jonas';
const CYRILLIC = 'Мария и Йонас';

/**
 * The client gallery's font pairings (theme/galleryFonts.mjs), each in its real scope: the
 * `next/font` classes and `data-gallery-font` on the same element (plan p04 D4.6–D4.8). A pairing
 * without Cyrillic is marked: its Cyrillic title falls back to the family's fallback face.
 */
export function GalleryTypography() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {PAIRINGS.map((p) => (
        <li key={p.id} className={`${GALLERY_FONT_CLASSES} flex flex-col gap-2 rounded-control bg-wash p-4`} data-gallery-font={p.id}>
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <Text size="body-sm" weight="semibold">
              {p.label}
            </Text>
            <Caption>
              {FAMILIES[p.display].label} + {FAMILIES[p.text].label}
            </Caption>
          </span>
          <Display size="md" as="p">
            {LATIN}
          </Display>
          <Display size="md" as="p" lang="bg">
            {CYRILLIC}
          </Display>
          {pairingCovers(p, CYRILLIC) ? null : <Caption>No Cyrillic: the Cyrillic title uses {FAMILIES[p.display].fallback.split(',')[0]}.</Caption>}
          <Text as="p" size="body" tone="ink2">
            The welcome note and captions are set in {FAMILIES[p.text].label}. Благодарим ви за деня.
          </Text>
        </li>
      ))}
    </ul>
  );
}
