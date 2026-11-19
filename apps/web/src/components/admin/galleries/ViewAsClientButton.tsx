'use client';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { Text } from '@repo/ui/typography';

type PreviewLink = { url: string; expiresAt: string };

/**
 * *View as client* (plan p06 D6.11): asks for a one-hour preview link and opens the gallery as a
 * client sees it, in a new tab (a draft too; a password draft without the password). The tab is
 * opened BEFORE the request, so a popup blocker sees a click, then pointed at the link; it is closed
 * again if the link cannot be made.
 */
export function ViewAsClientButton({ galleryId }: { galleryId: string }) {
  const { execute, loading, error } = useApi<PreviewLink>(`/api/admin/galleries/${galleryId}/preview-link`, { method: 'POST' });
  const details = error?.details as { message?: unknown } | undefined;
  const message = error ? (typeof details?.message === 'string' ? details.message : 'The preview could not be opened. Try again.') : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        disabled={loading}
        onClick={async () => {
          const tab = window.open('about:blank', '_blank');
          if (tab) tab.opener = null;
          const result = await execute({});
          if (result.data && tab) tab.location.href = result.data.url;
          else if (result.data) window.location.assign(result.data.url);
          else tab?.close();
        }}
      >
        View as client
      </Button>
      {message ? (
        <Text as="p" size="body-sm" tone="danger" role="alert">
          {message}
        </Text>
      ) : null}
    </div>
  );
}
