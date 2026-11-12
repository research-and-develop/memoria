import { Card } from '@repo/ui/layout';
import { Caption, Heading } from '@repo/ui/typography';

/** One block of the design page: a title, an optional note, then the samples. */
export function DesignSection({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Heading id={id} level={2}>
          {title}
        </Heading>
        {note ? <Caption>{note}</Caption> : null}
      </div>
      <Card className="flex flex-col gap-6 p-4 sm:p-6">{children}</Card>
    </section>
  );
}
