import { SWATCHES } from '@repo/ui/theme/gallery';
import { galleryAccent } from '@repo/ui/theme/galleryAccent';
import { Caption, Mono, Text } from '@repo/ui/typography';

const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto (follows the device)' },
] as const;

/**
 * The client gallery's themes (theme/gallery.mjs) with every accent swatch, painted by the real
 * `data-gallery-theme` / `data-gallery-accent` attributes (plan p04 D4.6): a swatch added there
 * appears here. Each tile carries both attributes because an accent rule matches them on one element.
 */
export function GalleryThemes() {
  return (
    <div className="flex flex-col gap-6">
      {THEMES.map((theme) => (
        <div key={theme.id} className="flex flex-col gap-2">
          <Text size="body-sm" weight="semibold">
            {theme.label}
          </Text>
          <ul data-gallery-theme={theme.id} className="grid grid-cols-2 gap-3 rounded-card bg-ground p-3 sm:grid-cols-3 lg:grid-cols-4">
            {SWATCHES.map((swatch) => (
              <li key={swatch.id} data-gallery-theme={theme.id} data-gallery-accent={swatch.id} className="flex flex-col gap-2 rounded-control bg-wash p-3 text-ink">
                <span className="flex items-center justify-between gap-2">
                  <Text size="body-sm" weight="semibold">
                    {swatch.label}
                  </Text>
                  <span aria-hidden className="size-4 rounded-full bg-accent" />
                </span>
                <span className="inline-flex w-fit rounded-button bg-accent px-3 py-1.5 text-body-sm font-semibold text-inverse">Favourite</span>
                <span className="text-body-sm text-accent-ink underline">A link in the welcome note</span>
                <span className="inline-flex w-fit rounded-full bg-accent-tint px-2 py-0.5 text-caption font-medium text-accent-ink">12 selected</span>
                <Text size="caption" tone="muted">
                  Muted meta line
                </Text>
                {theme.id !== 'auto' ? <AccentValues id={swatch.id} theme={theme.id} hex={swatch.hex} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The computed values: whether the swatch was mixed for this theme (D4.5). */
function AccentValues({ id, theme, hex }: { id: string; theme: 'light' | 'dark'; hex: string }) {
  const roles = galleryAccent(id, theme);
  const changed = roles.accent.DEFAULT !== hex || roles.accent.ink !== hex;
  return (
    <Caption>
      <Mono size="caption">{roles.accent.DEFAULT}</Mono> · ink <Mono size="caption">{roles.accent.ink}</Mono>
      {changed ? ' · adjusted' : ''}
    </Caption>
  );
}
