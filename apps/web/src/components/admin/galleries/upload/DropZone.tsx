'use client';

import { useRef, useState } from 'react';

import { Button } from '@repo/ui/button';
import { twMerge } from '@repo/ui/cn';
import { Caption, Text } from '@repo/ui/typography';

import { readDrop, type DroppedFile } from '@/lib/images/folders';

/**
 * Where photos go in (plan p05 T5.5): drop files or folders, or pick files. The drop's entries are
 * read inside the `drop` handler (a DataTransfer empties when it returns: `readDrop`). Every file is
 * passed on; the uploader decides what is supported, so nothing is filtered silently here.
 */
export function DropZone({ onFiles, disabled = false }: { onFiles: (files: DroppedFile[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (disabled) return;
        void readDrop(event.dataTransfer).then((files) => files.length > 0 && onFiles(files));
      }}
      data-testid="drop-zone"
      className={twMerge(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line-input bg-surface px-4 py-8 text-center transition-colors motion-reduce:transition-none',
        over && 'border-accent bg-accent-tint',
        disabled && 'opacity-60',
      )}
    >
      <Text as="p" weight="semibold">
        Drop photos or folders here
      </Text>
      <Caption>JPEG, PNG or WebP. Each folder becomes a set. Location data is removed from every photo before it leaves this computer.</Caption>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
        Choose photos
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onFiles(files.map((file) => ({ file, set: null })));
        }}
      />
    </div>
  );
}
