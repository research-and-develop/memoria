import { Card } from '@repo/ui/layout';
import { Heading, Text } from '@repo/ui/typography';

import { MessageActions } from '@/components/admin/MessageActions';
import { listInbox } from '@/lib/admin/inbox';
import { dateTimeLabel } from '@/lib/dates';

export const metadata = { title: 'Inbox' };

/** The inbox: the newest messages, read on the server through the domain module. */
export default async function AdminInboxPage() {
  const messages = await listInbox({ page: 1, pageSize: 50 });
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1} size="lg">
        Inbox
      </Heading>
      {messages.length === 0 ? <Text as="p">No messages yet.</Text> : null}
      <ul className="flex flex-col gap-4">
        {messages.map((m) => (
          <li key={m.id}>
            <Card tone="white" className="flex flex-col gap-3 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Text weight={m.is_read ? 'normal' : 'bold'} tone="ink">
                  {m.name} · {m.email}
                </Text>
                <Text size="xs">{dateTimeLabel(m.created_at)}</Text>
              </div>
              <Text as="p" className="whitespace-pre-line">
                {m.message}
              </Text>
              <MessageActions id={m.id} isRead={m.is_read} />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
