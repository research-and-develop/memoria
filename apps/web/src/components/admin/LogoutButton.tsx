'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';

import { Icon } from './icons';

/** Sign out of this device, then the sign-in page. `block`: the sidebar's full-width 44 px row. */
export function LogoutButton({ block = false }: { block?: boolean }) {
  const router = useRouter();
  const { execute, loading } = useApi('/api/admin/logout', { method: 'POST' });
  return (
    <Button
      size={block ? 'lg' : 'sm'}
      variant={block ? 'ghost' : 'secondary'}
      className={block ? 'w-full justify-start gap-2.5 px-3 font-medium text-ink-2' : undefined}
      loading={loading}
      onClick={async () => {
        await execute({});
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      {block && !loading ? <Icon name="signOut" /> : null}
      Sign out
    </Button>
  );
}
