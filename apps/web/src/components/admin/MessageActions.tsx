'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';

/**
 * Per-row actions. `useApi` is bound to ONE url, so each row gets its own
 * component (and its own hook) rather than one hook re-pointed per click.
 */
export function MessageActions({ id, isRead }: { id: string; isRead: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, loading } = useApi(`/api/admin/messages/${id}`);

  const run = async (body: unknown, method: 'PATCH' | 'DELETE') => {
    const result = await execute(body, { method });
    if (result.error) {
      if (result.error.errorCode !== 'ABORT_ERROR') setError(typeof result.error.details?.message === 'string' ? result.error.details.message : result.error.error);
      return;
    }
    setError(null);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="secondary" loading={loading} onClick={() => run({ isRead: !isRead }, 'PATCH')}>
        {isRead ? 'Mark unread' : 'Mark read'}
      </Button>
      <Button size="sm" variant="ghost" disabled={loading} onClick={() => run(undefined, 'DELETE')}>
        Delete
      </Button>
      {error ? (
        <span role="alert" className="text-caption font-semibold text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
