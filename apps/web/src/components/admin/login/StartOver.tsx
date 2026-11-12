'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';

/** "Start over": forget the half-finished sign-in and show step 1, even if the call fails. */
export function StartOver() {
  const router = useRouter();
  const { execute, loading } = useApi('/api/admin/login', { method: 'DELETE' });
  return (
    <Button
      variant="link"
      className="min-h-11 text-body-sm"
      loading={loading}
      onClick={async () => {
        await execute();
        router.refresh();
      }}
    >
      Start over
    </Button>
  );
}
