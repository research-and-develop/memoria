import { afterEach, describe, expect, it, vi } from 'vitest';

import { COMPLETE_BATCH, REGISTER_BATCH } from '@/lib/galleries/parseUploadInput';

import type { ProcessedPhoto, ProcessOptions, ProcessResult } from './process';
import type { SignedUpload } from './upload';
import { UploadError } from './upload';
import { createUploader, MAX_HELD, remainingSeconds, UploadApiError, type CompleteResult, type RegisteredPhoto, type UploaderDeps, type UploadSnapshot } from './uploader';
import { postJson } from './uploaderStore';

const OPTIONS: ProcessOptions = { display: { longEdge: 1600, quality: 75 }, thumb: { longEdge: 800, quality: 70 }, watermark: null, watermarkUrl: null };
const TARGET = { galleryId: 'g-1', setId: 's-1', options: OPTIONS };

const sha = (name: string) => Array.from(name.padEnd(32, '_'), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').slice(0, 64);
const file = (name: string, content = name) => new File([content], name);
const blob = (n: number, type: string) => new Blob([new Uint8Array(n)], { type });

function photo(name: string, content = name): ProcessedPhoto {
  return {
    original: blob(100, 'image/jpeg'),
    originalType: 'image/jpeg',
    sha256: sha(content),
    width: 6000,
    height: 4000,
    takenAt: '2026-06-14T15:42:07',
    meta: { camera: 'Canon EOS R5' },
    color: '#808080',
    ext: 'webp',
    derivativeType: 'image/webp',
    display: { blob: blob(20, 'image/webp'), width: 1600, height: 1067 },
    thumb: { blob: blob(10, 'image/webp'), width: 800, height: 534 },
  };
}

/**
 * A fake browser and server. The server answers `new` unless told otherwise, mints `put://<id>/<part>`
 * URLs, and completes every photo whose three PUTs it saw. Everything is logged in order.
 */
function harness(opts: { status?: Record<string, 'new' | 'resume' | 'duplicate'>; failPuts?: Record<string, number>; refuse?: string[]; completeFails?: Record<string, ('UPLOAD_MISSING' | 'UPLOAD_MISMATCH' | 'NOT_FOUND')[]>; registerError?: UploadApiError } = {}) {
  const log: string[] = [];
  const stored = new Set<string>();
  const failPuts = { ...(opts.failPuts ?? {}) };
  const completeFails = Object.fromEntries(Object.entries(opts.completeFails ?? {}).map(([k, v]) => [k, [...v]]));
  let nextId = 1;
  const ids = new Map<string, string>();
  const nameOf = new Map<string, string>();

  const deps: UploaderDeps = {
    probe: async (f) => {
      if (opts.refuse?.includes(f.name)) return { ok: false, refusal: { code: 'unsupported', kind: 'heic' } };
      return { ok: true, type: 'image/jpeg', width: 6000, height: 4000, megapixels: 24 };
    },
    process: async (f): Promise<ProcessResult> => {
      log.push(`process ${f.name}`);
      const content = await f.text();
      return { ok: true, photo: photo(f.name, content) };
    },
    post: async <T,>(url: string, body: unknown): Promise<T> => {
      if (url.endsWith('/uploads')) {
        const { setId, photos } = body as { setId: string; photos: { filename: string; sha256: string; bytes: Record<string, number> }[] };
        log.push(`register ${setId} [${photos.map((p) => p.filename).join(',')}]`);
        if (opts.registerError) throw opts.registerError;
        return photos.map((p): RegisteredPhoto => {
          const status = opts.status?.[p.filename] ?? 'new';
          if (status === 'duplicate') return { sha256: p.sha256, status };
          const id = ids.get(p.sha256) ?? `p${nextId++}`;
          ids.set(p.sha256, id);
          nameOf.set(id, p.filename);
          const put = (part: string): SignedUpload => ({ url: `put://${id}/${part}`, method: 'PUT', headers: { 'content-type': 'x' } });
          return { sha256: p.sha256, status, photoId: id, uploads: { original: put('original'), thumb: put('thumb'), display: put('display') } };
        }) as T;
      }
      const { photoIds } = body as { photoIds: string[] };
      log.push(`complete [${photoIds.map((id) => nameOf.get(id)).join(',')}]`);
      const result: CompleteResult = { ready: [], failed: [] };
      for (const id of photoIds) {
        const forced = completeFails[nameOf.get(id)!]?.shift();
        const all = ['original', 'thumb', 'display'].every((p) => stored.has(`${id}/${p}`));
        if (forced) result.failed.push({ id, reason: forced });
        else if (all) result.ready.push(id);
        else result.failed.push({ id, reason: 'UPLOAD_MISSING' });
      }
      return result as T;
    },
    put: async (b, upload, { onProgress }) => {
      const key = upload.url.slice('put://'.length);
      log.push(`put ${nameOf.get(key.split('/')[0]!)}/${key.split('/')[1]}`);
      if ((failPuts[key] ?? 0) > 0) {
        failPuts[key]!--;
        throw new UploadError('Upload failed (network)', 0);
      }
      onProgress(1);
      stored.add(key);
      void b;
    },
    now: () => 1_000,
  };
  return { deps, log, stored };
}

const names = (n: number, prefix = 'IMG_') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}.jpg`);
const drop = (list: string[]) => list.map((name) => ({ file: file(name), set: null }));
const statuses = (s: UploadSnapshot) => Object.fromEntries(Object.entries(s.counts).filter(([, n]) => n > 0));

afterEach(() => vi.unstubAllGlobals());

describe('createUploader', () => {
  it('one photo: process, register, three PUTs, complete — in that order', async () => {
    const { deps, log } = harness();
    const uploader = createUploader(deps);
    uploader.add(drop(['a.jpg']), TARGET);
    await uploader.whenIdle();
    expect(log).toEqual(['process a.jpg', 'register s-1 [a.jpg]', 'put a.jpg/original', 'put a.jpg/thumb', 'put a.jpg/display', 'complete [a.jpg]']);
    const snap = uploader.getSnapshot();
    expect(statuses(snap)).toEqual({ done: 1 });
    expect(snap.running).toBe(false);
    expect(snap.bytes).toEqual({ sent: 130, total: 130 });
  });

  it(`registers in batches of ${REGISTER_BATCH} and completes in batches of ${COMPLETE_BATCH}`, async () => {
    const { deps, log } = harness();
    const uploader = createUploader(deps);
    uploader.add(drop(names(23)), TARGET);
    await uploader.whenIdle();
    const registers = log.filter((l) => l.startsWith('register')).map((l) => l.split(',').length);
    const completes = log.filter((l) => l.startsWith('complete')).map((l) => l.split(',').length);
    expect(registers.every((n) => n <= REGISTER_BATCH)).toBe(true);
    expect(registers.reduce((a, b) => a + b, 0)).toBe(23);
    expect(registers[0]).toBe(REGISTER_BATCH);
    expect(completes.every((n) => n <= COMPLETE_BATCH)).toBe(true);
    expect(completes.reduce((a, b) => a + b, 0)).toBe(23);
    expect(completes.filter((n) => n === COMPLETE_BATCH).length).toBeGreaterThanOrEqual(2);
    expect(statuses(uploader.getSnapshot())).toEqual({ done: 23 });
  });

  it('duplicates: the server says so, or the same bytes twice in one drop; neither is uploaded', async () => {
    const { deps, log } = harness({ status: { 'known.jpg': 'duplicate' } });
    const uploader = createUploader(deps);
    uploader.add([{ file: file('known.jpg'), set: null }, { file: file('a.jpg', 'same'), set: null }, { file: file('copy-of-a.jpg', 'same'), set: null }], TARGET);
    await uploader.whenIdle();
    expect(statuses(uploader.getSnapshot())).toEqual({ done: 1, duplicate: 2 });
    expect(log.filter((l) => l.startsWith('put')).map((l) => l.split('/')[0])).toEqual(['put a.jpg', 'put a.jpg', 'put a.jpg']);
    expect(log.find((l) => l.startsWith('register'))).toBe('register s-1 [known.jpg,a.jpg]');
    expect(uploader.getSnapshot().bytes.total).toBe(130); // duplicates weigh nothing
  });

  it('resume: an unfinished upload of the same file gets its PUTs again and is marked', async () => {
    const { deps, log } = harness({ status: { 'half.jpg': 'resume' } });
    const uploader = createUploader(deps);
    uploader.add(drop(['half.jpg']), TARGET);
    await uploader.whenIdle();
    expect(log.filter((l) => l.startsWith('put'))).toHaveLength(3);
    expect(uploader.getSnapshot().files[0]).toMatchObject({ status: 'done', resumed: true });
  });

  it('refused files carry the reason and never reach the server', async () => {
    const { deps, log } = harness({ refuse: ['IMG_0001.HEIC'] });
    const uploader = createUploader(deps);
    uploader.add(drop(['IMG_0001.HEIC', 'a.jpg']), TARGET);
    await uploader.whenIdle();
    expect(uploader.getSnapshot().files[0]).toMatchObject({ name: 'IMG_0001.HEIC', status: 'refused', refusal: { code: 'unsupported', kind: 'heic' } });
    expect(log.some((l) => l.includes('HEIC'))).toBe(false);
  });

  it('a failed PUT is retried once; a second failure reports the photo, which is never completed', async () => {
    const { deps, log } = harness({ failPuts: { 'p1/thumb': 1, 'p2/display': 2 } });
    const uploader = createUploader(deps);
    uploader.add(drop(['once.jpg', 'twice.jpg']), TARGET);
    await uploader.whenIdle();
    expect(log.filter((l) => l === 'put once.jpg/thumb')).toHaveLength(2);
    expect(log.filter((l) => l === 'put twice.jpg/display')).toHaveLength(2);
    expect(log.filter((l) => l.startsWith('complete'))).toEqual(['complete [once.jpg]']);
    const [once, twice] = uploader.getSnapshot().files;
    expect(once).toMatchObject({ status: 'done' });
    expect(twice).toMatchObject({ status: 'failed', error: expect.stringMatching(/upload failed/i) });
  });

  it('a complete that finds an object missing or wrong re-PUTs the photo once, then reports it', async () => {
    const { deps, log } = harness({ completeFails: { 'flaky.jpg': ['UPLOAD_MISMATCH'], 'lost.jpg': ['UPLOAD_MISSING', 'UPLOAD_MISSING'], 'gone.jpg': ['NOT_FOUND'] } });
    const uploader = createUploader(deps);
    uploader.add(drop(['flaky.jpg', 'lost.jpg', 'gone.jpg']), TARGET);
    await uploader.whenIdle();
    expect(log.filter((l) => l.startsWith('put flaky.jpg'))).toHaveLength(6);
    expect(log.filter((l) => l.startsWith('put lost.jpg'))).toHaveLength(6);
    expect(log.filter((l) => l.startsWith('put gone.jpg'))).toHaveLength(3);
    const byName = Object.fromEntries(uploader.getSnapshot().files.map((f) => [f.name, f]));
    expect(byName['flaky.jpg']).toMatchObject({ status: 'done' });
    expect(byName['lost.jpg']).toMatchObject({ status: 'failed', error: expect.stringMatching(/did not arrive/) });
    expect(byName['gone.jpg']).toMatchObject({ status: 'failed', error: expect.stringMatching(/removed/) });
  });

  it("a register error fails the batch with the server's message; Retry processes them again", async () => {
    const failing: { registerError?: UploadApiError } = { registerError: new UploadApiError('Choose a set of this gallery.', 400, 'INVALID_SET') };
    const h = harness(failing);
    const uploader = createUploader(h.deps);
    uploader.add(drop(['a.jpg', 'b.jpg']), TARGET);
    await uploader.whenIdle();
    expect(uploader.getSnapshot().files.map((f) => [f.status, f.error])).toEqual([
      ['failed', 'Choose a set of this gallery.'],
      ['failed', 'Choose a set of this gallery.'],
    ]);
    expect(uploader.getSnapshot().bytes).toEqual({ sent: 0, total: 0 });
    failing.registerError = undefined;
    uploader.retryFailed();
    await uploader.whenIdle();
    expect(statuses(uploader.getSnapshot())).toEqual({ done: 2 });
    expect(h.log.filter((l) => l === 'process a.jpg')).toHaveLength(2);
  });

  it('cancel stops the queue: nothing more is processed, registered or uploaded', async () => {
    const { deps, log } = harness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slowProcess = deps.process;
    deps.process = async (f, o, run) => {
      if (f.name === 'IMG_003.jpg') await gate;
      if (run.signal.aborted) throw new DOMException('cancelled', 'AbortError');
      return slowProcess(f, o, run);
    };
    const uploader = createUploader(deps);
    uploader.add(drop(names(5)), TARGET);
    await vi.waitFor(() => expect(log).toContain('process IMG_002.jpg'));
    uploader.cancel();
    release();
    await uploader.whenIdle();
    const snap = uploader.getSnapshot();
    expect(snap.running).toBe(false);
    expect(snap.counts.cancelled).toBe(5);
    expect(log.some((l) => l.startsWith('register') || l.startsWith('put'))).toBe(false);
  });

  it('never holds more than MAX_HELD processed photos', async () => {
    const { deps } = harness();
    let peak = 0;
    const uploader = createUploader(deps);
    uploader.subscribe(() => {
      const c = uploader.getSnapshot().counts;
      peak = Math.max(peak, c.waiting + c.uploading + c.completing + c.processing);
    });
    uploader.add(drop(names(60)), TARGET);
    await uploader.whenIdle();
    expect(peak).toBeLessThanOrEqual(MAX_HELD);
    expect(statuses(uploader.getSnapshot())).toEqual({ done: 60 });
  });

  it('MAX_HELD leaves room for both batches (no stall)', () => {
    expect(MAX_HELD).toBeGreaterThan(REGISTER_BATCH + COMPLETE_BATCH - 2);
  });

  it('files of another set wait for their own register request; ready photos are announced per set', async () => {
    const { deps, log } = harness();
    const uploader = createUploader(deps);
    const ready: string[] = [];
    uploader.onReady((setId, ids) => ready.push(`${setId}:${ids.length}`));
    uploader.add(drop(['a.jpg']), TARGET);
    uploader.add(drop(['b.jpg']), { ...TARGET, setId: 's-2' });
    await uploader.whenIdle();
    expect(log.filter((l) => l.startsWith('register'))).toEqual(['register s-1 [a.jpg]', 'register s-2 [b.jpg]']);
    expect(ready.sort()).toEqual(['s-1:1', 's-2:1']);
  });

  it('the snapshot is stable between changes and listeners hear every change', async () => {
    const { deps } = harness();
    const uploader = createUploader(deps);
    const listener = vi.fn();
    const unsubscribe = uploader.subscribe(listener);
    expect(uploader.getSnapshot()).toBe(uploader.getSnapshot());
    uploader.add(drop(['a.jpg']), TARGET);
    await uploader.whenIdle();
    expect(listener.mock.calls.length).toBeGreaterThan(3);
    unsubscribe();
    uploader.clear();
    expect(listener.mock.calls.length).toBeGreaterThan(3);
    expect(uploader.getSnapshot().files).toEqual([]);
  });
});

describe('remainingSeconds', () => {
  const snap = (counts: Partial<UploadSnapshot['counts']>, running = true): UploadSnapshot => ({
    files: [],
    counts: { queued: 0, processing: 0, waiting: 0, uploading: 0, completing: 0, done: 0, duplicate: 0, refused: 0, failed: 0, cancelled: 0, ...counts },
    running,
    bytes: { sent: 0, total: 0 },
    startedAt: 0,
  });
  it.each([
    ['fewer than three finished', snap({ done: 2, queued: 10 }), 20_000, null],
    ['10 done in 20 s, 10 left → 20 s', snap({ done: 10, queued: 10 }), 20_000, 20],
    ['duplicates count as finished', snap({ done: 5, duplicate: 5, uploading: 5 }), 10_000, 5],
    ['nothing left', snap({ done: 10 }), 20_000, null],
    ['not running', snap({ done: 10, failed: 2 }, false), 20_000, null],
  ])('%s', (_, s, now, expected) => {
    expect(remainingSeconds(s, now)).toBe(expected);
  });
});

describe('postJson', () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('unwraps { data }', async () => {
    vi.stubGlobal('fetch', respond(200, { data: [1, 2] }));
    await expect(postJson('/x', {}, new AbortController().signal)).resolves.toEqual([1, 2]);
  });

  it("throws the envelope's message and code", async () => {
    vi.stubGlobal('fetch', respond(429, { error: 'Too many uploads in an hour. Try again later.', errorCode: 'RATE_LIMITED' }));
    await expect(postJson('/x', {}, new AbortController().signal)).rejects.toMatchObject({ name: 'UploadApiError', status: 429, code: 'RATE_LIMITED', message: 'Too many uploads in an hour. Try again later.' });
  });

  it.each([
    [400, { error: 'TOO_MANY_SETS', errorCode: 'TOO_MANY_SETS', details: { message: 'A gallery can have up to 50 sets.' } }, 'A gallery can have up to 50 sets.'],
    [400, { error: 'INVALID_SET', errorCode: 'INVALID_SET' }, 'Something went wrong. Try again.'],
    [500, { error: 'D1 exploded', errorCode: 'INTERNAL' }, 'Something went wrong. Try again.'],
  ])('a %i failure shows its sentence, never a code or server text', async (status, body, message) => {
    vi.stubGlobal('fetch', respond(status, body));
    await expect(postJson('/x', {}, new AbortController().signal)).rejects.toMatchObject({ code: body.errorCode, message });
  });

  it('a non-JSON failure becomes a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    await expect(postJson('/x', {}, new AbortController().signal)).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });
});
