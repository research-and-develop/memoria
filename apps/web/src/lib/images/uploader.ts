import { COMPLETE_BATCH, REGISTER_BATCH } from '@/lib/galleries/parseUploadInput';

import type { DroppedFile } from './folders';
import type { Probe } from './probe';
import type { ProcessedPhoto, ProcessOptions, ProcessResult } from './process';
import type { FileRefusal } from './refusals';
import type { SignedUpload } from './upload';

/**
 * The upload queue (plan p05 T5.5, D5.8, D5.9): each dropped file goes
 * probe → process (the worker pool) → register (≤ 10 per request) → three PUTs (4 at a time, each
 * retried once) → complete (≤ 8 per request). A photo the server already has is `duplicate`; one it
 * holds as unfinished is `resume` (new PUTs to the same keys). A complete that finds an object missing
 * or wrong re-PUTs that photo once, then reports it. Failed files can be retried (processed again:
 * their URLs may have expired); refused files carry the reason.
 *
 * Memory: at most `MAX_HELD` processed photos (original + two derivatives) are held between
 * processing and completion; processing waits for room. A photo's blobs are released once it is done,
 * duplicate, failed or cancelled.
 *
 * Framework-free: the browser and the network come in as `deps`, so the order of events is tested
 * with fakes (`uploader.test.ts`). `uploaderFor(galleryId)` (`uploaderStore.ts`) keeps one per
 * gallery for the page's `useSyncExternalStore`.
 */

export const PUT_PARALLEL = 4;
/**
 * Processed photos held in memory at once (two register batches). It must exceed
 * REGISTER_BATCH + COMPLETE_BATCH − 2, or a full house of photos waiting below both batch sizes
 * could stall the queue (uploader.test.ts pins it).
 */
export const MAX_HELD = 2 * REGISTER_BATCH;
/** Re-PUTs after a complete that found an object missing or wrong (D5.8: once). */
export const COMPLETE_RETRIES = 1;

type Part = 'original' | 'thumb' | 'display';
const PARTS: readonly Part[] = ['original', 'thumb', 'display'];
type Uploads = Record<Part, SignedUpload>;

export type RegisteredPhoto = { sha256: string; status: 'new' | 'resume' | 'duplicate'; photoId?: string; uploads?: Uploads };
export type CompleteFailure = { id: string; reason: 'UPLOAD_MISSING' | 'UPLOAD_MISMATCH' | 'NOT_FOUND' };
export type CompleteResult = { ready: string[]; failed: CompleteFailure[] };

/** An API failure: the envelope's message is shown to the photographer. */
export class UploadApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UploadApiError';
  }
}

export type UploaderDeps = {
  probe: (file: File) => Promise<Probe>;
  process: (file: File, options: ProcessOptions, run: { megapixels: number; signal: AbortSignal }) => Promise<ProcessResult>;
  /** POST JSON, resolve with the envelope's `data`; reject with `UploadApiError`. */
  post: <T>(url: string, body: unknown, signal: AbortSignal) => Promise<T>;
  put: (blob: Blob, upload: SignedUpload, opts: { onProgress: (fraction: number) => void; signal: AbortSignal }) => Promise<void>;
  now?: () => number;
  /** Called when the queue drains (the store frees the worker pool). */
  onIdle?: () => void;
};

export type FileStatus = 'queued' | 'processing' | 'waiting' | 'uploading' | 'completing' | 'done' | 'duplicate' | 'refused' | 'failed' | 'cancelled';
const FINAL: ReadonlySet<FileStatus> = new Set(['done', 'duplicate', 'refused', 'failed', 'cancelled']);

export type UploadFile = {
  key: number;
  name: string;
  /** The folder it came from (a set to create, commit 6), or null. */
  folder: string | null;
  status: FileStatus;
  refusal?: FileRefusal;
  error?: string;
  /** Registered as `resume`: an earlier, unfinished upload of the same file. */
  resumed?: boolean;
  /** Bytes sent of `total` (the three objects); 0/0 until processed. */
  sent: number;
  total: number;
};

export type UploadSnapshot = {
  files: readonly UploadFile[];
  counts: Record<FileStatus, number>;
  running: boolean;
  bytes: { sent: number; total: number };
  startedAt: number | null;
};

export type UploadTarget = { galleryId: string; setId: string; options: ProcessOptions };

export type Uploader = {
  add(files: readonly DroppedFile[], target: UploadTarget): void;
  retryFailed(): void;
  cancel(): void;
  /** Forget finished files (when nothing runs). */
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** Photos that became ready, per complete request and set (the grid refreshes that set). */
  onReady(listener: (setId: string, photoIds: string[]) => void): () => void;
  getSnapshot(): UploadSnapshot;
  /** Resolves when nothing is queued or in flight. */
  whenIdle(): Promise<void>;
};

type Item = {
  key: number;
  file: File;
  folder: string | null;
  target: UploadTarget;
  status: FileStatus;
  refusal?: FileRefusal;
  error?: string;
  resumed?: boolean;
  photo?: ProcessedPhoto;
  photoId?: string;
  uploads?: Uploads;
  partSent: Record<Part, number>;
  /** Bytes of the three objects, kept after the blobs are released (0 for a duplicate). */
  total: number;
  partsLeft: number;
  /** Bumped when the item's PUTs are restarted, so late results of the old ones are ignored. */
  round: number;
  completeRetries: number;
};

const MESSAGES = {
  processing: 'Processing failed. Retry, or export the photo again.',
  upload: 'The upload failed. Check the connection and retry.',
  missing: 'The upload did not arrive. Retry.',
  mismatch: 'The uploaded file did not match. Retry.',
  gone: 'This photo was removed meanwhile.',
} as const;

const isAbort = (error: unknown) => (error as { name?: string })?.name === 'AbortError';
const sizes = (photo: ProcessedPhoto): Record<Part, number> => ({ original: photo.original.size, thumb: photo.thumb.blob.size, display: photo.display.blob.size });
const blobOf = (photo: ProcessedPhoto, part: Part): Blob => (part === 'original' ? photo.original : photo[part].blob);
const errorMessage = (error: unknown, fallback: string) => (error instanceof UploadApiError ? error.message : fallback);

export function createUploader(deps: UploaderDeps): Uploader {
  const now = deps.now ?? (() => Date.now());
  const items: Item[] = [];
  const listeners = new Set<() => void>();
  const readyListeners = new Set<(setId: string, photoIds: string[]) => void>();
  const idleWaiters: (() => void)[] = [];
  /** Content hashes of this session's live photos: a second copy in one drop is a duplicate. */
  const hashes = new Map<string, Item>();
  let controller = new AbortController();
  let nextKey = 1;
  let startedAt: number | null = null;
  let snapshot: UploadSnapshot | null = null;
  let registering = false;
  let completing = false;
  let putsInFlight = 0;
  const putQueue: { item: Item; part: Part; round: number }[] = [];
  let progressTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------- state

  const count = (...statuses: FileStatus[]) => items.filter((i) => statuses.includes(i.status)).length;
  const held = () => items.filter((i) => i.photo).length;
  const busy = () => items.some((i) => !FINAL.has(i.status));

  function emit() {
    snapshot = null;
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    for (const listener of listeners) listener();
    if (!busy()) {
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }

  /** Progress events are many: coalesce them. */
  function emitSoon() {
    progressTimer ??= setTimeout(emit, 150);
  }

  function release(item: Item) {
    if (item.photo && hashes.get(item.photo.sha256) === item) hashes.delete(item.photo.sha256);
    item.photo = undefined;
    item.uploads = undefined;
  }

  function finish(item: Item, status: 'done' | 'duplicate' | 'refused' | 'failed' | 'cancelled', extra: { error?: string; refusal?: FileRefusal } = {}) {
    if (status === 'duplicate') item.total = 0;
    if (status === 'done' || status === 'duplicate') {
      item.photo = undefined; // the hash stays taken for this session
      item.uploads = undefined;
    } else release(item);
    item.status = status;
    item.error = extra.error;
    item.refusal = extra.refusal;
  }

  function settle() {
    pump();
    emit();
    if (!busy()) deps.onIdle?.();
  }

  // ---------------------------------------------------------------- stages

  function pump() {
    // 1. Process while there is room in memory.
    for (const item of items) {
      if (item.status !== 'queued') continue;
      if (held() + count('processing') >= MAX_HELD) break;
      void processItem(item);
    }
    // 2. Register a full batch, or what is left once nothing else is being processed.
    if (!registering) {
      const waiting = items.filter((i) => i.status === 'waiting');
      const first = waiting[0];
      if (first && (waiting.length >= REGISTER_BATCH || count('queued', 'processing') === 0)) {
        void register(waiting.filter((i) => i.target.setId === first.target.setId).slice(0, REGISTER_BATCH));
      }
    }
    // 3. PUTs, four at a time.
    while (putsInFlight < PUT_PARALLEL && putQueue.length > 0) {
      const job = putQueue.shift()!;
      if (job.item.status !== 'uploading' || job.round !== job.item.round) continue;
      void putPart(job.item, job.part, job.round);
    }
    // 4. Complete a full batch, or what is left once nothing upstream remains.
    if (!completing) {
      const uploaded = items.filter((i) => i.status === 'completing' && i.partsLeft === 0);
      const upstream = count('queued', 'processing', 'waiting') > 0 || registering || items.some((i) => i.status === 'uploading');
      if (uploaded.length >= COMPLETE_BATCH || (uploaded.length > 0 && !upstream)) void complete(uploaded.slice(0, COMPLETE_BATCH));
    }
  }

  async function processItem(item: Item) {
    item.status = 'processing';
    emit();
    const signal = controller.signal;
    try {
      const probe = await deps.probe(item.file);
      if (signal.aborted || item.status !== 'processing') return;
      if (!probe.ok) return finish(item, 'refused', { refusal: probe.refusal });
      const result = await deps.process(item.file, item.target.options, { megapixels: probe.megapixels, signal });
      if (signal.aborted || item.status !== 'processing') return;
      if (!result.ok) return finish(item, 'refused', { refusal: result.refusal });
      const twin = hashes.get(result.photo.sha256);
      if (twin && twin !== item) return finish(item, 'duplicate');
      hashes.set(result.photo.sha256, item);
      item.photo = result.photo;
      item.total = Object.values(sizes(result.photo)).reduce((a, b) => a + b, 0);
      item.partSent = { original: 0, thumb: 0, display: 0 };
      item.status = 'waiting';
    } catch (error) {
      if (item.status !== 'processing') return;
      if (isAbort(error)) finish(item, 'cancelled');
      else finish(item, 'failed', { error: MESSAGES.processing });
    } finally {
      settle();
    }
  }

  async function register(batch: Item[]) {
    registering = true;
    const signal = controller.signal;
    const target = batch[0]!.target;
    const photos = batch.map((item) => {
      const p = item.photo!;
      return {
        filename: item.file.name,
        contentType: p.originalType,
        sha256: p.sha256,
        bytes: sizes(p),
        width: p.width,
        height: p.height,
        displayWidth: p.display.width,
        displayHeight: p.display.height,
        derivativeExt: p.ext,
        takenAt: p.takenAt,
        color: p.color,
        meta: p.meta,
      };
    });
    try {
      const answer = await deps.post<RegisteredPhoto[]>(`/api/admin/galleries/${target.galleryId}/uploads`, { setId: target.setId, photos }, signal);
      const bySha = new Map(answer.map((r) => [r.sha256, r]));
      for (const item of batch) {
        if (item.status !== 'waiting') continue;
        const r = bySha.get(item.photo!.sha256);
        if (!r) finish(item, 'failed', { error: MESSAGES.upload });
        else if (r.status === 'duplicate' || !r.uploads || !r.photoId) finish(item, 'duplicate');
        else {
          item.photoId = r.photoId;
          item.uploads = r.uploads;
          item.resumed = r.status === 'resume';
          startPuts(item);
        }
      }
    } catch (error) {
      for (const item of batch) {
        if (item.status !== 'waiting') continue;
        if (isAbort(error)) finish(item, 'cancelled');
        else finish(item, 'failed', { error: errorMessage(error, MESSAGES.upload) });
      }
    } finally {
      registering = false;
      settle();
    }
  }

  function startPuts(item: Item) {
    item.round++;
    item.status = 'uploading';
    item.partsLeft = PARTS.length;
    item.partSent = { original: 0, thumb: 0, display: 0 };
    for (const part of PARTS) putQueue.push({ item, part, round: item.round });
  }

  async function putPart(item: Item, part: Part, round: number) {
    putsInFlight++;
    const signal = controller.signal;
    const photo = item.photo!;
    const upload = item.uploads![part];
    const size = blobOf(photo, part).size;
    const onProgress = (fraction: number) => {
      if (item.round !== round) return;
      item.partSent[part] = Math.round(fraction * size);
      emitSoon();
    };
    try {
      try {
        await deps.put(blobOf(photo, part), upload, { onProgress, signal });
      } catch (error) {
        if (isAbort(error) || signal.aborted) throw error;
        item.partSent[part] = 0;
        await deps.put(blobOf(photo, part), upload, { onProgress, signal }); // one retry
      }
      if (item.round !== round || item.status !== 'uploading') return;
      item.partSent[part] = size;
      item.partsLeft--;
      if (item.partsLeft === 0) item.status = 'completing';
    } catch (error) {
      if (item.round !== round || item.status !== 'uploading') return;
      if (isAbort(error)) finish(item, 'cancelled');
      else finish(item, 'failed', { error: MESSAGES.upload });
    } finally {
      putsInFlight--;
      settle();
    }
  }

  async function complete(batch: Item[]) {
    completing = true;
    const signal = controller.signal;
    for (const item of batch) item.partsLeft = -1; // taken by this request
    const galleryId = batch[0]!.target.galleryId;
    try {
      const result = await deps.post<CompleteResult>(`/api/admin/galleries/${galleryId}/uploads/complete`, { photoIds: batch.map((i) => i.photoId) }, signal);
      const ready = new Set(result.ready);
      const failed = new Map(result.failed.map((f) => [f.id, f.reason]));
      const readyBySet = new Map<string, string[]>();
      for (const item of batch) {
        if (item.status !== 'completing') continue;
        const reason = failed.get(item.photoId!);
        if (ready.has(item.photoId!)) {
          finish(item, 'done');
          readyBySet.set(item.target.setId, [...(readyBySet.get(item.target.setId) ?? []), item.photoId!]);
        }
        else if (reason === 'NOT_FOUND' || reason === undefined) finish(item, 'failed', { error: MESSAGES.gone });
        else if (item.completeRetries < COMPLETE_RETRIES) {
          item.completeRetries++;
          startPuts(item); // UPLOAD_MISMATCH already deleted the objects; MISSING never had them
        } else finish(item, 'failed', { error: reason === 'UPLOAD_MISSING' ? MESSAGES.missing : MESSAGES.mismatch });
      }
      for (const [setId, photoIds] of readyBySet) for (const listener of readyListeners) listener(setId, photoIds);
    } catch (error) {
      for (const item of batch) {
        if (item.status !== 'completing') continue;
        if (isAbort(error)) finish(item, 'cancelled');
        else finish(item, 'failed', { error: errorMessage(error, MESSAGES.upload) });
      }
    } finally {
      completing = false;
      settle();
    }
  }

  // ---------------------------------------------------------------- the API

  function build(): UploadSnapshot {
    const counts = Object.fromEntries(['queued', 'processing', 'waiting', 'uploading', 'completing', 'done', 'duplicate', 'refused', 'failed', 'cancelled'].map((s) => [s, 0])) as Record<FileStatus, number>;
    let sent = 0;
    let total = 0;
    const files = items.map((item): UploadFile => {
      counts[item.status]++;
      const counted = item.status !== 'failed' && item.status !== 'cancelled';
      const itemTotal = counted ? item.total : 0;
      const itemSent = item.status === 'done' ? itemTotal : counted ? PARTS.reduce((n, p) => n + item.partSent[p], 0) : 0;
      sent += itemSent;
      total += itemTotal;
      return {
        key: item.key,
        name: item.file.name,
        folder: item.folder,
        status: item.status,
        ...(item.refusal ? { refusal: item.refusal } : {}),
        ...(item.error ? { error: item.error } : {}),
        ...(item.resumed ? { resumed: true } : {}),
        sent: itemSent,
        total: itemTotal,
      };
    });
    return { files, counts, running: busy(), bytes: { sent, total }, startedAt };
  }

  return {
    add(files, target) {
      if (files.length === 0) return;
      if (!busy()) startedAt = now();
      for (const { file, set } of files) {
        items.push({ key: nextKey++, file, folder: set, target, status: 'queued', partSent: { original: 0, thumb: 0, display: 0 }, total: 0, partsLeft: 0, round: 0, completeRetries: 0 });
      }
      settle();
    },
    retryFailed() {
      const failed = items.filter((i) => i.status === 'failed' || i.status === 'cancelled');
      if (failed.length === 0) return;
      if (!busy()) startedAt = now();
      for (const item of failed) {
        release(item);
        Object.assign(item, { status: 'queued', error: undefined, refusal: undefined, resumed: undefined, photoId: undefined, completeRetries: 0, partsLeft: 0, total: 0 });
        item.round++;
      }
      settle();
    },
    cancel() {
      controller.abort();
      controller = new AbortController();
      putQueue.length = 0;
      for (const item of items) if (!FINAL.has(item.status)) finish(item, 'cancelled');
      settle();
    },
    clear() {
      if (busy()) return;
      items.length = 0;
      hashes.clear();
      startedAt = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReady(listener) {
      readyListeners.add(listener);
      return () => {
        readyListeners.delete(listener);
      };
    },
    getSnapshot() {
      snapshot ??= build();
      return snapshot;
    },
    whenIdle() {
      return busy() ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
    },
  };
}

/**
 * Seconds left, from the pace so far (finished files per elapsed second); null until three files
 * have finished. Pure.
 */
export function remainingSeconds(snapshot: UploadSnapshot, nowMs: number): number | null {
  const c = snapshot.counts;
  const finished = c.done + c.duplicate;
  const left = c.queued + c.processing + c.waiting + c.uploading + c.completing;
  if (!snapshot.running || snapshot.startedAt === null || finished < 3 || left === 0) return null;
  const elapsed = (nowMs - snapshot.startedAt) / 1000;
  return Math.max(1, Math.round((elapsed / finished) * left));
}
