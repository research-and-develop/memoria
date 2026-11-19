import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UploadApiError, type UploadFile, type UploadSnapshot } from '@/lib/images/uploader';

import { DropZone } from './DropZone';
import { formatBytes, formatRemaining } from './format';
import { GalleryUploader, READY_EVERY_MS, snapshotWatermark } from './GalleryUploader';
import { foldersOf, UploadPanel, uploadSummary } from './UploadPanel';

/** The page's uploader and set creation, faked: jsdom has no Web Workers. */
const store = vi.hoisted(() => ({
  add: vi.fn(),
  postJson: vi.fn(),
  /** The uploader's ready listener, for the test to fire. */
  ready: null as ((setId: string, photoIds: string[]) => void) | null,
  /** One object: useSyncExternalStore needs a stable snapshot. */
  snapshot: { files: [], counts: { queued: 0, processing: 0, waiting: 0, uploading: 0, completing: 0, done: 0, duplicate: 0, refused: 0, failed: 0, cancelled: 0 }, running: false, bytes: { sent: 0, total: 0 }, startedAt: null },
}));
vi.mock('@/lib/images/uploaderStore', () => ({
  postJson: (...args: unknown[]) => store.postJson(...args),
  uploaderFor: () => ({
    add: store.add,
    retryFailed: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    subscribe: () => () => undefined,
    onReady: (listener: (setId: string, photoIds: string[]) => void) => {
      store.ready = listener;
      return () => {
        store.ready = null;
      };
    },
    getSnapshot: () => store.snapshot,
    whenIdle: async () => undefined,
  }),
}));

type Entry = { name: string; isFile: boolean; isDirectory: boolean; file?: (ok: (f: File) => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void) => void } };
const fileEntry = (name: string): Entry => ({ name, isFile: true, isDirectory: false, file: (ok) => ok(new File(['x'], name)) });
const dirEntry = (name: string, children: Entry[]): Entry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let done = false;
    return {
      readEntries: (ok) => {
        ok(done ? [] : children);
        done = true;
      },
    };
  },
});
const dropOn = (zone: HTMLElement, root: Entry) => fireEvent.drop(zone, { dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }], files: [] } });

const COUNTS = { queued: 0, processing: 0, waiting: 0, uploading: 0, completing: 0, done: 0, duplicate: 0, refused: 0, failed: 0, cancelled: 0 };
let nextKey = 1;
const f = (name: string, status: UploadFile['status'], extra: Partial<UploadFile> = {}): UploadFile => ({ key: nextKey++, name, folder: null, status, sent: 0, total: 0, ...extra });
function snap(files: UploadFile[], extra: Partial<UploadSnapshot> = {}): UploadSnapshot {
  const counts = { ...COUNTS };
  for (const file of files) counts[file.status]++;
  const running = files.some((x) => !['done', 'duplicate', 'refused', 'failed', 'cancelled'].includes(x.status));
  return { files, counts, running, bytes: { sent: 0, total: 0 }, startedAt: 0, ...extra };
}
const panel = (s: UploadSnapshot, handlers: Partial<Record<'onCancel' | 'onRetry' | 'onClear', () => void>> = {}) =>
  render(<UploadPanel snapshot={s} now={60_000} onCancel={handlers.onCancel ?? vi.fn()} onRetry={handlers.onRetry ?? vi.fn()} onClear={handlers.onClear ?? vi.fn()} />);

describe('format', () => {
  it.each([
    [0, '0 B'],
    [1536, '1.5 KB'],
    [12_345_678, '11.8 MB'],
    [250 * 1024 * 1024, '250 MB'],
    [3.5 * 1024 ** 3, '3.5 GB'],
  ])('formatBytes(%d) = %s', (n, expected) => expect(formatBytes(n)).toBe(expected));

  it.each([
    [40, 'less than a minute'],
    [150, 'about 3 min'],
    [3600, 'about 1 h'],
    [4000, 'about 1 h 7 min'],
  ])('formatRemaining(%d) = %s', (n, expected) => expect(formatRemaining(n)).toBe(expected));
});

describe('UploadPanel', () => {
  it('renders nothing before the first drop', () => {
    const { container } = panel(snap([]));
    expect(container).toBeEmptyDOMElement();
  });

  it('while running: progress, bytes, time left, and Cancel', () => {
    const onCancel = vi.fn();
    const files = [...Array.from({ length: 6 }, (_, i) => f(`d${i}.jpg`, 'done')), ...Array.from({ length: 6 }, (_, i) => f(`q${i}.jpg`, 'queued'))];
    panel(snap(files, { bytes: { sent: 50 * 1024 * 1024, total: 100 * 1024 * 1024 } }), { onCancel });
    expect(screen.getByText('Uploading 6 of 12 photos · 50.0 MB of 100 MB · about 1 min left')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('aria-valuenow', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('done: the count, Clear, failed files with their reason and Retry, refused files with a sentence', () => {
    const onRetry = vi.fn();
    const onClear = vi.fn();
    panel(
      snap([
        f('a.jpg', 'done'),
        f('b.jpg', 'failed', { error: 'The upload failed. Check the connection and retry.' }),
        f('IMG_1.HEIC', 'refused', { refusal: { code: 'unsupported', kind: 'heic' } }),
        f('home.png', 'refused', { refusal: { code: 'metadata' } }),
      ]),
      { onRetry, onClear },
    );
    expect(screen.getByText('1 photo uploaded')).toBeInTheDocument();
    expect(screen.getByText('1 photo not uploaded')).toBeInTheDocument();
    expect(screen.getByText('The upload failed. Check the connection and retry.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('2 files not supported')).toBeInTheDocument();
    expect(screen.getByText('HEIC photos are not supported. Export them as JPEG.')).toBeInTheDocument();
    expect(screen.getByText(/carries metadata/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('duplicates skipped and unfinished uploads finished are counted', () => {
    panel(snap([f('a.jpg', 'duplicate'), f('b.jpg', 'duplicate'), f('c.jpg', 'done', { resumed: true })]));
    expect(screen.getByText(/2 duplicates skipped/)).toBeInTheDocument();
    expect(screen.getByText(/1 unfinished upload finished/)).toBeInTheDocument();
  });

  it('lists the folders of the drop and their sets', () => {
    const files = [f('c1.jpg', 'queued', { folder: 'Ceremony' }), f('c2.jpg', 'queued', { folder: 'Ceremony' }), f('p1.jpg', 'queued', { folder: 'Party' }), f('top.jpg', 'queued')];
    expect(foldersOf(files)).toEqual([
      ['Ceremony', 2],
      ['Party', 1],
    ]);
    panel(snap(files));
    expect(screen.getByText('Into the sets of their folders: Ceremony (2), Party (1).')).toBeInTheDocument();
  });

  it('a long list is cut at 50', () => {
    panel(snap(Array.from({ length: 60 }, (_, i) => f(`x${i}.gif`, 'refused', { refusal: { code: 'unsupported', kind: 'gif' } }))));
    expect(screen.getByText('and 10 more')).toBeInTheDocument();
  });

  it.each([
    ['running: refused files are not counted', [f('a', 'done'), f('b', 'uploading'), f('c', 'refused')], 'Uploading 1 of 2 photos'],
    ['finished', [f('a', 'done'), f('b', 'done')], '2 photos uploaded'],
    ['cancelled', [f('a', 'done'), f('b', 'cancelled')], 'Cancelled · 1 photo uploaded'],
    ['only duplicates', [f('a', 'duplicate'), f('b', 'refused')], 'Nothing new to upload'],
  ])('uploadSummary: %s', (_, files, expected) => {
    expect(uploadSummary(snap(files), 0)).toBe(expected);
  });
});

describe('DropZone', () => {
  it('a dropped folder: its subfolders become set names', async () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const entry = (name: string) => ({ name, isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(new File(['x'], name)) });
    const sub = { name: 'Ceremony', isFile: false, isDirectory: true, createReader: () => { let done = false; return { readEntries: (ok: (e: unknown[]) => void) => { ok(done ? [] : [entry('c1.jpg')]); done = true; } }; } };
    const root = { name: 'Shoot', isFile: false, isDirectory: true, createReader: () => { let done = false; return { readEntries: (ok: (e: unknown[]) => void) => { ok(done ? [] : [entry('top.jpg'), sub]); done = true; } }; } };
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null }], files: [] } });
    await waitFor(() => expect(onFiles).toHaveBeenCalled());
    expect(onFiles.mock.calls[0]![0].map((d: { set: string | null; file: File }) => `${d.set}/${d.file.name}`)).toEqual(['null/top.jpg', 'Ceremony/c1.jpg']);
  });

  it('Choose photos: picked files go to the chosen set', () => {
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} />);
    const input = container.querySelector('input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg')] } });
    expect(onFiles).toHaveBeenCalledWith([{ file: expect.any(File), set: null }]);
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeInTheDocument();
  });

  it('disabled: nothing is taken', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} disabled />);
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
  });
});

describe('GalleryUploader', () => {
  const G = '00000000-0000-4000-8000-000000000001';
  const profile = { processing: { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 } }, watermark: null, imageUrl: null };
  const SETS = [
    { id: 's-main', name: 'Main' },
    { id: 's-cer', name: 'Ceremony' },
  ];
  const mount = (extra: Partial<Parameters<typeof GalleryUploader>[0]> = {}) => {
    const handlers = { onPhotosReady: vi.fn(), onSetsChanged: vi.fn() };
    render(<GalleryUploader galleryId={G} setId="s-main" sets={SETS} profile={profile} {...handlers} {...extra} />);
    return handlers;
  };

  it.each([
    ['none', null, null],
    ['a text watermark', { kind: 'text', text: '© Ana', font: 'sans', ink: 'light', position: 'bottom-right', size: 20, opacity: 60, margin: 3 }, { kind: 'text', text: '© Ana' }],
    ['an unreadable one', { kind: 'image', key: 'nope' }, 'invalid'],
  ])('snapshotWatermark: %s', (_, raw, expected) => {
    const result = snapshotWatermark(raw as Record<string, unknown> | null);
    if (expected && typeof expected === 'object') expect(result).toMatchObject(expected);
    else expect(result).toBe(expected);
  });

  it('names the set loose photos go into, and takes picked files there', () => {
    store.add.mockClear();
    mount({ setId: 's-cer' });
    expect(screen.getByText('Loose photos go into “Ceremony”; photos in a folder go into the set named after it.')).toBeInTheDocument();
    const picker = screen.getByTestId('drop-zone').querySelector('input[type="file"]')!;
    fireEvent.change(picker, { target: { files: [new File(['x'], 'a.jpg')] } });
    expect(store.add).toHaveBeenCalledWith([{ file: expect.any(File), set: null }], expect.objectContaining({ galleryId: G, setId: 's-cer' }));
  });

  it('refuses to upload when the watermark snapshot cannot be read', () => {
    mount({ galleryId: '00000000-0000-4000-8000-000000000002', profile: { ...profile, watermark: { kind: 'image', key: 'nope' } } });
    expect(screen.getByRole('alert')).toHaveTextContent(/watermark cannot be read/);
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
  });

  it('without a current set nothing can be dropped', () => {
    mount({ setId: '' });
    expect(screen.getByRole('button', { name: 'Choose photos' })).toBeDisabled();
  });

  it('dropped folders: an existing set is reused (any case), a missing one is created once, loose files go to the current set', async () => {
    store.add.mockClear();
    store.postJson.mockReset().mockResolvedValue({ id: 's-party' });
    const { onSetsChanged } = mount();
    const zone = screen.getByTestId('drop-zone');
    dropOn(zone, dirEntry('Shoot', [fileEntry('cover.jpg'), dirEntry('ceremony', [fileEntry('c1.jpg')]), dirEntry('Party', [fileEntry('p1.jpg'), fileEntry('p2.jpg')])]));
    await waitFor(() => expect(store.add).toHaveBeenCalledTimes(3));
    expect(store.postJson).toHaveBeenCalledTimes(1);
    expect(store.postJson.mock.calls[0]!.slice(0, 2)).toEqual([`/api/admin/galleries/${G}/sets`, { name: 'Party' }]);
    const added = Object.fromEntries(store.add.mock.calls.map(([files, target]) => [target.setId, files.map((f: { file: File }) => f.file.name)]));
    expect(added).toEqual({ 's-main': ['cover.jpg'], 's-cer': ['c1.jpg'], 's-party': ['p1.jpg', 'p2.jpg'] });
    expect(onSetsChanged).toHaveBeenCalledTimes(1);

    // Again, before the manager's sets include "Party": it is not created twice.
    dropOn(zone, dirEntry('Shoot', [dirEntry('PARTY', [fileEntry('p3.jpg')])]));
    await waitFor(() => expect(store.add).toHaveBeenCalledTimes(4));
    expect(store.postJson).toHaveBeenCalledTimes(1);
    expect(store.add.mock.calls[3]![1]).toMatchObject({ setId: 's-party' });
  });

  it('a set that cannot be created stops the whole drop, with the reason', async () => {
    store.add.mockClear();
    store.postJson.mockReset().mockRejectedValue(new UploadApiError('A gallery can have up to 50 sets.', 400, 'TOO_MANY_SETS'));
    const { onSetsChanged } = mount();
    dropOn(screen.getByTestId('drop-zone'), dirEntry('Shoot', [fileEntry('cover.jpg'), dirEntry('Party', [fileEntry('p1.jpg')])]));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A gallery can have up to 50 sets. Nothing from this drop was uploaded.'));
    expect(store.add).not.toHaveBeenCalled();
    expect(onSetsChanged).not.toHaveBeenCalled();
  });

  it('ready photos: the first batch at once, then at most one call per window', () => {
    vi.useFakeTimers();
    try {
      const { onPhotosReady } = mount();
      act(() => store.ready!('s-main', ['p1']));
      expect(onPhotosReady).toHaveBeenLastCalledWith(['s-main']);
      act(() => {
        store.ready!('s-main', ['p2']);
        store.ready!('s-cer', ['p3']);
      });
      expect(onPhotosReady).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(READY_EVERY_MS));
      expect(onPhotosReady).toHaveBeenCalledTimes(2);
      expect(onPhotosReady).toHaveBeenLastCalledWith(['s-main', 's-cer']);
      act(() => vi.advanceTimersByTime(READY_EVERY_MS)); // a quiet window closes without a call
      act(() => store.ready!('s-main', ['p4']));
      expect(onPhotosReady).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the unfinished-uploads banner when the server has some', () => {
    mount({ galleryId: '00000000-0000-4000-8000-000000000003', unfinished: 3 });
    expect(screen.getByRole('status')).toHaveTextContent('3 photos did not finish uploading. Drop the same files again');
  });
});
