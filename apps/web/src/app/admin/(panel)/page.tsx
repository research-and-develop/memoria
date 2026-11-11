import { Heading, Text } from '@repo/ui/typography';

export const metadata = { title: 'Dashboard' };

/** The admin dashboard: a placeholder until Phase 11 fills it. */
export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-3">
      <Heading level={1}>Dashboard</Heading>
      <Text as="p" tone="muted">
        Nothing here yet.
      </Text>
    </div>
  );
}
