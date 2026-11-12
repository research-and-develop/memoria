import { Card } from '@repo/ui/layout';
import { Heading, Text } from '@repo/ui/typography';

/** One section of Settings → Security: a card with its `<h2>`, a line under it, and an action on the right. */
export function SecuritySection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={2} size="title" id={`${id}-title`}>
            {title}
          </Heading>
          {description ? (
            <Text as="p" size="body-sm" tone="muted">
              {description}
            </Text>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
