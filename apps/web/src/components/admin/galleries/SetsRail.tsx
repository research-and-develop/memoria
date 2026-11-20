'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { twMerge } from '@repo/ui/cn';
import { Caption, Text } from '@repo/ui/typography';

import { Icon } from '@/components/admin/icons';

import { adminFetch } from './adminFetch';

export type ManagerSet = { id: string; name: string; photoCount: number };

/**
 * The manager's sets (plan p05 → Screens): pick one, rename it inline, move it up or down (buttons,
 * so the keyboard can reorder), add one. Each change is saved at once and the parent reloads the list.
 * Focus stays on the control that acted (or the set it acted on), never dropped to the page: the
 * buttons are not disabled while a call runs (a disabled button loses focus), they ignore clicks.
 */
export function SetsRail({
  galleryId,
  sets,
  selected,
  onSelect,
  onChanged,
  onError,
}: {
  galleryId: string;
  sets: readonly ManagerSet[];
  selected: string;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  /** `data-focus` of the control to focus once the list has re-rendered (`added:<n>`: the new last set). */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!pendingFocus || !nav) return;
    let key = pendingFocus;
    if (pendingFocus.startsWith('added:')) {
      // Wait for the reloaded list that holds the new set.
      if (sets.length <= Number(pendingFocus.slice('added:'.length))) return;
      key = `select-${sets[sets.length - 1]!.id}`;
    }
    const el = nav.querySelector<HTMLButtonElement>(`[data-focus="${key}"]`);
    // A move button at the end of the list is disabled: fall back to its set.
    const fallback = nav.querySelector<HTMLButtonElement>(`[data-focus="select-${key.replace(/^(up|down)-/, '')}"]`);
    (el && !el.disabled ? el : fallback)?.focus();
    setPendingFocus(null);
  }, [pendingFocus, sets, renaming, adding]);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    const result = await adminFetch(url, { method, body });
    setBusy(false);
    onError(result.ok ? null : result.error);
    if (result.ok) onChanged();
    return result.ok;
  }

  async function move(index: number, by: -1 | 1) {
    if (busy) return;
    const id = sets[index]!.id;
    setPendingFocus(`${by < 0 ? 'up' : 'down'}-${id}`);
    const ids = sets.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    await call(`/api/admin/galleries/${galleryId}/sets/order`, 'PUT', { ids });
  }

  async function submitRename(event: FormEvent, id: string) {
    event.preventDefault();
    if (await call(`/api/admin/galleries/${galleryId}/sets/${id}`, 'PATCH', { name })) {
      setRenaming(null);
      setPendingFocus(`select-${id}`);
    }
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (await call(`/api/admin/galleries/${galleryId}/sets`, 'POST', { name })) {
      setAdding(false);
      setName('');
      setPendingFocus(`added:${sets.length}`);
    }
  }

  return (
    <nav ref={navRef} aria-label="Sets" className="flex flex-col gap-2">
      <Text size="body-sm" weight="semibold">
        Sets
      </Text>
      <ul className="flex flex-col gap-1">
        {sets.map((set, index) => (
          <li key={set.id} className="flex items-center gap-1">
            {renaming === set.id ? (
              <form onSubmit={(e) => void submitRename(e, set.id)} className="flex min-w-0 flex-1 gap-1">
                <Input aria-label={`New name for ${set.name}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
                <Button type="submit" size="sm" disabled={busy}>
                  Save
                </Button>
              </form>
            ) : (
              <button
                type="button"
                data-focus={`select-${set.id}`}
                aria-current={set.id === selected ? 'true' : undefined}
                onClick={() => onSelect(set.id)}
                onDoubleClick={() => {
                  setRenaming(set.id);
                  setName(set.name);
                }}
                className={twMerge(
                  'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-3 text-left font-sans text-body-sm text-ink-2 hover:bg-wash',
                  set.id === selected && 'bg-wash font-semibold text-ink',
                )}
              >
                <span className="truncate">{set.name}</span>
                <Caption>{set.photoCount}</Caption>
              </button>
            )}
            {renaming !== set.id ? (
              <span className="flex shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Rename ${set.name}`}
                  onClick={() => {
                    setRenaming(set.id);
                    setName(set.name);
                  }}
                >
                  <Icon name="pencil" size={16} />
                </Button>
                <Button size="icon" variant="ghost" data-focus={`up-${set.id}`} aria-label={`Move ${set.name} up`} disabled={index === 0} onClick={() => void move(index, -1)}>
                  <Icon name="up" size={16} />
                </Button>
                <Button size="icon" variant="ghost" data-focus={`down-${set.id}`} aria-label={`Move ${set.name} down`} disabled={index === sets.length - 1} onClick={() => void move(index, 1)}>
                  <Icon name="down" size={16} />
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={(e) => void submitAdd(e)} className="flex gap-1">
          <Input aria-label="Set name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Add
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          data-focus="add"
          className="self-start"
          disabled={sets.length >= 50}
          onClick={() => {
            setAdding(true);
            setName('');
          }}
        >
          + Add set
        </Button>
      )}
    </nav>
  );
}
