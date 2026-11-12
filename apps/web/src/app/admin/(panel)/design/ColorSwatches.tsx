import { contrastRatio } from '@repo/ui/colorContrast';
import { flattenColors } from '@repo/ui/theme/cssVars';
import studio from '@repo/ui/theme/studio';
import { Caption, Mono, Text } from '@repo/ui/typography';

/**
 * Every colour role of the theme, read from theme/studio.mjs: a role added there appears here.
 * The swatch paints the role's CSS variable (what the app really uses); the ratio is the role as
 * text on `surface` (AA needs 4.5 for body text).
 */
export function ColorSwatches() {
  const groups = new Map<string, [string, string][]>();
  for (const [name, hex] of flattenColors(studio.colors)) {
    const group = name.split('-')[0] ?? name;
    groups.set(group, [...(groups.get(group) ?? []), [name, hex]]);
  }
  // The bare role first (`ink` before `ink-2`: JS orders numeric keys first).
  for (const roles of groups.values()) roles.sort(([a], [b]) => Number(b.indexOf('-') === -1) - Number(a.indexOf('-') === -1));
  return (
    <div className="flex flex-col gap-5">
      {[...groups].map(([group, roles]) => (
        <div key={group} className="flex flex-col gap-2">
          <Text size="body-sm" weight="semibold">
            {group}
          </Text>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {roles.map(([name, hex]) => (
              <li key={name} className="flex flex-col gap-1.5">
                <span aria-hidden className="h-12 rounded-control ring-1 ring-inset ring-line" style={{ backgroundColor: `rgb(var(--color-${name}))` }} />
                <Mono size="body-sm">{name}</Mono>
                <Caption>
                  {hex} · {contrastRatio(name, 'surface').toFixed(2)}:1 on surface
                </Caption>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
