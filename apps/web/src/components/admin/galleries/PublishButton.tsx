'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';

/** Publish / Unpublish a gallery (D5.19), then refresh the server-rendered page. */
export function PublishButton({ galleryId, published }: { galleryId: string; published: boolean }) {
  const router = useRouter();
  const { execute, loading } = useApi(`/api/admin/galleries/${galleryId}/${published ? 'unpublish' : 'publish'}`, { method: 'POST' });
  return (
    <Button
      variant={published ? 'secondary' : 'primary'}
      disabled={loading}
      onClick={async () => {
        const result = await execute({});
        if (!result.error) router.refresh();
      }}
    >
      {published ? 'Unpublish' : 'Publish'}
    </Button>
  );
}
