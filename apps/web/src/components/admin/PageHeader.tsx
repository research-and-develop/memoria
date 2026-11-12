import { Heading, Text } from '@repo/ui/typography';

/**
 * The top of an admin page: its one `<h1>`, a line under it, and the page's actions on the right
 * (they wrap under the title on a phone). Every admin page starts with it; the page sets the gap
 * below (a `flex flex-col gap-7` column).
 */
export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading level={1} size="heading-lg">
          {title}
        </Heading>
        {description ? (
          <Text as="p" tone="muted">
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
