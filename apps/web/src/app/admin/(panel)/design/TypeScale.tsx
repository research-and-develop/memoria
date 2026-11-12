import studio from '@repo/ui/theme/studio';
import { Caption, Eyebrow, Heading, Label, Mono, Text } from '@repo/ui/typography';

const SAMPLE = 'Maria & Jonas · 248 photos';

/** The type scale, read from theme/studio.mjs (a size added there appears here), then the primitives. */
export function TypeScale() {
  const sizes = Object.entries(studio.fontSize);
  return (
    <div className="flex flex-col gap-8">
      <ul className="flex flex-col gap-4">
        {sizes.map(([token, [size, { lineHeight, letterSpacing }]]) => (
          <li key={token} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-6">
            <span className="flex w-40 shrink-0 flex-col">
              <Mono size="body-sm">text-{token}</Mono>
              <Caption>
                {Number.parseFloat(size) * 16}px / {lineHeight}
                {letterSpacing ? ` / ${letterSpacing}` : ''}
              </Caption>
            </span>
            <span className="min-w-0 break-words font-sans text-ink" style={{ fontSize: size, lineHeight, letterSpacing, textTransform: token === 'eyebrow' ? 'uppercase' : undefined }}>
              {SAMPLE}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Weights
        </Text>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(['normal', 'medium', 'semibold', 'title', 'bold'] as const).map((weight) => (
            <Text key={weight} size="body-lg" weight={weight}>
              {weight}
            </Text>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Primitives
        </Text>
        <Heading level={1}>Heading 1 · Good morning</Heading>
        <Heading level={2}>Heading 2 · Galleries</Heading>
        <Heading level={3}>Heading 3 · Branding</Heading>
        <Heading level={4}>Heading 4 · Card title</Heading>
        <Heading level={3} size="stat">
          1,284
        </Heading>
        <Eyebrow>Eyebrow · Recent activity</Eyebrow>
        <Label>Label · Gallery title</Label>
        <Text as="p">Text · The default body text of the studio.</Text>
        <Text as="p" tone="ink2">
          Text ink2 · secondary text.
        </Text>
        <Text as="p" tone="muted">
          Text muted · tertiary text and placeholders.
        </Text>
        <Caption>Caption · 12 May 2026 · 248 photos</Caption>
        <Mono>IMG_2048.jpg</Mono>
        <Text as="p" size="body-lg" lang="bg">
          Cyrillic in Inter: Мария и Йонас · Сватба в Пловдив
        </Text>
      </div>
    </div>
  );
}
