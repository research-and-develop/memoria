'use client';

import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { Select } from '@repo/ui/input';
import { Text } from '@repo/ui/typography';

import { ConfirmDialog } from '@/components/admin/security/ConfirmDialog';

import { adminFetch } from './adminFetch';
import type { ManagerSet } from './SetsRail';

/**
 * The actions on the selected photos (plan p05 → Screens): move to another set, hide, show, set as
 * cover (exactly one), delete (after a confirm). ≤ 90 at a time, the API's limit.
 */
export function BulkBar({
  galleryId,
  selected,
  sets,
  currentSet,
  onDone,
  onError,
}: {
  galleryId: string;
  selected: readonly string[];
  sets: readonly ManagerSet[];
  currentSet: string;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const targets = sets.filter((s) => s.id !== currentSet);
  const tooMany = selected.length > 90;

  async function act(url: string, method: string, body: unknown) {
    setBusy(true);
    const result = await adminFetch(url, { method, body });
    setBusy(false);
    onError(result.ok ? null : result.error);
    if (result.ok) onDone();
    return result.ok;
  }
  const bulk = (body: Record<string, unknown>) => act(`/api/admin/galleries/${galleryId}/photos/bulk`, 'POST', { ids: selected, ...body });

  return (
    <div role="toolbar" aria-label="Selected photos" className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-panel bg-surface p-3 shadow-control ring-1 ring-line">
      <Text size="body-sm" weight="semibold" className="mr-2">
        {selected.length} selected{tooMany ? ' (90 at a time)' : ''}
      </Text>
      {targets.length > 0 ? (
        <Select
          aria-label="Move to set"
          value=""
          disabled={busy || tooMany}
          onChange={(e) => {
            if (e.target.value) void bulk({ action: 'move', setId: e.target.value });
          }}
          className="w-auto"
        >
          <option value="">Move to…</option>
          {targets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Button variant="secondary" size="sm" disabled={busy || tooMany} onClick={() => void bulk({ action: 'hide' })}>
        Hide
      </Button>
      <Button variant="secondary" size="sm" disabled={busy || tooMany} onClick={() => void bulk({ action: 'show' })}>
        Show
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || selected.length !== 1}
        onClick={() => void act(`/api/admin/galleries/${galleryId}/cover`, 'PUT', { photoId: selected[0] })}
      >
        Set as cover
      </Button>
      <Button variant="danger" size="sm" disabled={busy || tooMany} onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${selected.length} ${selected.length === 1 ? 'photo' : 'photos'}?`}
        body="They disappear from the gallery at once; their files are removed shortly after. This cannot be undone."
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (await bulk({ action: 'delete' })) setConfirmDelete(false);
        }}
      />
    </div>
  );
}
