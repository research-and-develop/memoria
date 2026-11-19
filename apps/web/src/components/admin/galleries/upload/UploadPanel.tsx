'use client';

import { Button } from '@repo/ui/button';
import { Caption, Text } from '@repo/ui/typography';

import { refusalMessage } from '@/lib/images/refusals';
import { remainingSeconds, type UploadFile, type UploadSnapshot } from '@/lib/images/uploader';

import { formatBytes, formatRemaining, plural } from './format';

/** Folders in the drop, with how many files each (each went to the set of its name). */
export function foldersOf(files: readonly UploadFile[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of files) if (f.folder) counts.set(f.folder, (counts.get(f.folder) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

/** The summary line: what is happening, how much is done, how long is left. */
export function uploadSummary(snapshot: UploadSnapshot, now: number): string {
  const c = snapshot.counts;
  const finished = c.done + c.duplicate;
  const total = snapshot.files.length - c.refused - c.cancelled;
  if (snapshot.running) {
    const left = remainingSeconds(snapshot, now);
    const bytes = snapshot.bytes.total > 0 ? ` · ${formatBytes(snapshot.bytes.sent)} of ${formatBytes(snapshot.bytes.total)}` : '';
    return `Uploading ${finished} of ${plural(total, 'photo', 'photos')}${bytes}${left ? ` · ${formatRemaining(left)} left` : ''}`;
  }
  const uploaded = `${plural(c.done, 'photo', 'photos')} uploaded`;
  if (c.cancelled > 0) return `Cancelled · ${uploaded}`;
  if (c.done === 0 && c.failed === 0 && c.duplicate > 0) return 'Nothing new to upload';
  return uploaded;
}

/**
 * The upload panel (plan p05 T5.5): progress, then what needs attention — files refused (with the
 * reason), duplicates skipped, failed files with Retry — and Cancel while running.
 */
export function UploadPanel({
  snapshot,
  now,
  onCancel,
  onRetry,
  onClear,
}: {
  snapshot: UploadSnapshot;
  now: number;
  onCancel: () => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  if (snapshot.files.length === 0) return null;
  const c = snapshot.counts;
  const refused = snapshot.files.filter((f) => f.status === 'refused');
  const failed = snapshot.files.filter((f) => f.status === 'failed' || f.status === 'cancelled');
  const resumed = snapshot.files.filter((f) => f.resumed && f.status === 'done').length;
  const folders = foldersOf(snapshot.files);
  const fraction = snapshot.bytes.total > 0 ? snapshot.bytes.sent / snapshot.bytes.total : 0;

  return (
    <section aria-label="Upload" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="p" weight="semibold" aria-live="polite">
          {uploadSummary(snapshot, now)}
        </Text>
        <div className="flex gap-2">
          {snapshot.running ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {snapshot.running && (
        <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-2 overflow-hidden rounded-full bg-wash">
          <div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}

      {folders.length > 0 && <Caption>Into the sets of their folders: {folders.map(([name, n]) => `${name} (${n})`).join(', ')}.</Caption>}

      {(c.duplicate > 0 || resumed > 0) && (
        <Caption>
          {c.duplicate > 0 && `${plural(c.duplicate, 'duplicate', 'duplicates')} skipped (already in this gallery or dropped twice). `}
          {resumed > 0 && `${plural(resumed, 'unfinished upload', 'unfinished uploads')} finished.`}
        </Caption>
      )}

      {failed.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Text as="h3" size="body-sm" weight="semibold" tone="danger">
              {plural(failed.length, 'photo', 'photos')} not uploaded
            </Text>
            {!snapshot.running && (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
          <FileList files={failed} reason={(f) => f.error ?? 'Cancelled.'} />
        </div>
      )}

      {refused.length > 0 && (
        <div className="flex flex-col gap-2">
          <Text as="h3" size="body-sm" weight="semibold">
            {plural(refused.length, 'file', 'files')} not supported
          </Text>
          <FileList files={refused} reason={(f) => (f.refusal ? refusalMessage(f.refusal) : '')} />
        </div>
      )}
    </section>
  );
}

const SHOWN = 50;

function FileList({ files, reason }: { files: readonly UploadFile[]; reason: (f: UploadFile) => string }) {
  return (
    <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-control border border-line">
      {files.slice(0, SHOWN).map((f) => (
        <li key={f.key} className="relative flex flex-col gap-0.5 px-3 py-2">
          <Text size="body-sm" className="break-all">
            {f.name}
          </Text>
          <Caption>{reason(f)}</Caption>
        </li>
      ))}
      {files.length > SHOWN && (
        <li className="px-3 py-2">
          <Caption>and {files.length - SHOWN} more</Caption>
        </li>
      )}
    </ul>
  );
}
