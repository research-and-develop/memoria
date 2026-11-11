'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';

export function LogoutButton() {
  const router = useRouter();
  const { execute, loading } = useApi('/api/admin/logout', { method: 'POST' });
  return (
    <Button
      size="sm"
      variant="outline"
      loading={loading}
      onClick={async () => {
        await execute({});
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
