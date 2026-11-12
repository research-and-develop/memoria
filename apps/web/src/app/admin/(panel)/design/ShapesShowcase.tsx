import { Button } from '@repo/ui/button';
import { Card, Pill, type PillTone } from '@repo/ui/layout';
import studio from '@repo/ui/theme/studio';
import { Caption, Mono, Text } from '@repo/ui/typography';

const PILLS: PillTone[] = ['live', 'proofing', 'draft', 'scheduled', 'expired', 'neutral', 'accent', 'alert'];

/** Pills, cards, radii (read from the theme), the shadow and the focus ring on each surface. */
export function ShapesShowcase() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Pills
        </Text>
        <div className="flex flex-wrap gap-2">
          {PILLS.map((tone) => (
            <Pill key={tone} tone={tone}>
              {tone}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {PILLS.map((tone) => (
            <Pill key={tone} tone={tone} size="sm">
              {tone}
            </Pill>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Cards
        </Text>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex flex-col gap-1 p-4">
            <Text weight="title">Card · surface</Text>
            <Caption>A border on the surface fill.</Caption>
          </Card>
          <Card tone="wash" className="flex flex-col gap-1 p-4">
            <Text weight="title">Card · wash</Text>
            <Caption>A quiet fill, no border.</Caption>
          </Card>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Radii and shadow
        </Text>
        <div className="flex flex-wrap gap-4">
          {Object.entries(studio.borderRadius).map(([token, value]) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <span aria-hidden className="h-14 w-20 border border-line-input bg-wash" style={{ borderRadius: value }} />
              <Mono>rounded-{token}</Mono>
              <Caption>{value}</Caption>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <span aria-hidden className="h-14 w-20 rounded-control bg-surface shadow-control" />
            <Mono>shadow-control</Mono>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Text size="body-sm" weight="semibold">
          Focus ring
        </Text>
        <Caption>Press Tab through these: the ring must be clearly visible on each surface.</Caption>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-wrap gap-2 rounded-card bg-ground p-4">
            <Button size="sm">On ground</Button>
            <Button size="sm" variant="secondary">
              Secondary
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 rounded-card border border-line bg-surface p-4">
            <Button size="sm" variant="dark">
              On surface
            </Button>
            <Button size="sm" variant="ghost">
              Ghost
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-wash p-4">
            <Button size="sm" variant="danger">
              On wash
            </Button>
            <Button variant="link">Link</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
