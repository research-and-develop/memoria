import { describe, expect, it } from 'vitest';

import { poolSize } from './imagePool';
import { createPool, type WorkerLike } from './pool';

/** A fake worker: records what it is sent; the test answers, crashes or watches it be terminated. */
class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  received: { id: number; input: string }[] = [];
  terminated = false;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: unknown) {
    this.received.push(message as { id: number; input: string });
  }
  terminate() {
    this.terminated = true;
  }
  get current() {
    return this.received.at(-1)!;
  }
  answer(output = `done:${this.current.input}`) {
    this.onmessage?.({ data: { id: this.current.id, ok: true, output } });
  }
  fail(error: string) {
    this.onmessage?.({ data: { id: this.current.id, ok: false, error } });
  }
}

function setup(size: number, maxWeight: number) {
  FakeWorker.all = [];
  const pool = createPool<string, string>(() => new FakeWorker(), { size, maxWeight });
  const inputs = () => FakeWorker.all.flatMap((w) => w.received.map((r) => r.input));
  return { pool, inputs };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createPool', () => {
  it('runs up to `size` tasks at once, starting workers lazily and reusing them', async () => {
    const { pool, inputs } = setup(2, 1000);
    const a = pool.run('a', { weight: 1 });
    const b = pool.run('b', { weight: 1 });
    const c = pool.run('c', { weight: 1 });
    expect(FakeWorker.all).toHaveLength(2);
    expect(inputs()).toEqual(['a', 'b']);
    expect(pool.queued).toBe(1);
    FakeWorker.all[0]!.answer();
    await expect(a).resolves.toBe('done:a');
    expect(FakeWorker.all[0]!.received.map((r) => r.input)).toEqual(['a', 'c']); // c went to the free worker
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]!.answer();
    FakeWorker.all[0]!.answer();
    await expect(b).resolves.toBe('done:b');
    await expect(c).resolves.toBe('done:c');
    expect(pool.running).toBe(0);
  });

  it('caps the decoded megapixels in flight; FIFO, so a heavy head waits rather than being overtaken', async () => {
    const { pool, inputs } = setup(4, 80);
    const runs = [pool.run('p50', { weight: 50 }), pool.run('p24', { weight: 24 }), pool.run('p40', { weight: 40 }), pool.run('p5', { weight: 5 })];
    expect(inputs()).toEqual(['p50', 'p24']);
    expect(pool.weightInFlight).toBe(74);
    FakeWorker.all[0]!.answer(); // p50 done: 24 + 40 + 5 = 69 fit
    await runs[0];
    expect(new Set(inputs())).toEqual(new Set(['p50', 'p24', 'p40', 'p5']));
    expect(pool.weightInFlight).toBe(69);
  });

  it('a task heavier than the budget runs alone', async () => {
    const { pool, inputs } = setup(4, 80);
    const small = pool.run('small', { weight: 10 });
    const huge = pool.run('huge', { weight: 100 });
    const after = pool.run('after', { weight: 1 });
    expect(inputs()).toEqual(['small']);
    FakeWorker.all[0]!.answer();
    await small;
    expect(inputs()).toEqual(['small', 'huge']);
    expect(pool.running).toBe(1);
    FakeWorker.all[0]!.answer();
    await huge;
    expect(inputs()).toEqual(['small', 'huge', 'after']);
    FakeWorker.all[0]!.answer();
    await after;
  });

  it('cancels a queued task without touching a worker', async () => {
    const { pool, inputs } = setup(1, 100);
    const controller = new AbortController();
    const first = pool.run('first', { weight: 1 });
    const queued = pool.run('queued', { weight: 1, signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    FakeWorker.all[0]!.answer();
    await first;
    await tick();
    expect(inputs()).toEqual(['first']);
    expect(FakeWorker.all[0]!.terminated).toBe(false);
  });

  it('cancels a running task by terminating its worker, frees its budget and replaces the worker', async () => {
    const { pool, inputs } = setup(1, 100);
    const controller = new AbortController();
    const running = pool.run('running', { weight: 60, signal: controller.signal });
    const next = pool.run('next', { weight: 60 });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    expect(inputs()).toEqual(['running', 'next']);
    expect(pool.weightInFlight).toBe(60);
    FakeWorker.all[0]!.onmessage?.({ data: { id: 1, ok: true, output: 'late' } }); // the dead worker's answer is ignored
    FakeWorker.all[1]!.answer();
    await expect(next).resolves.toBe('done:next');
  });

  it('a signal aborted before running rejects at once', async () => {
    const { pool } = setup(1, 100);
    await expect(pool.run('x', { weight: 1, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('a worker error message rejects the task; a crash also replaces the worker', async () => {
    const { pool } = setup(1, 100);
    const failed = pool.run('bad', { weight: 1 });
    FakeWorker.all[0]!.fail('decode failed');
    await expect(failed).rejects.toThrow('decode failed');
    const crashed = pool.run('crash', { weight: 1 });
    FakeWorker.all[0]!.onerror?.(new Event('error'));
    await expect(crashed).rejects.toThrow(/stopped unexpectedly/);
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const ok = pool.run('ok', { weight: 1 });
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]!.answer();
    await expect(ok).resolves.toBe('done:ok');
  });

  it('destroy terminates every worker and rejects running and queued tasks', async () => {
    const { pool } = setup(1, 100);
    const running = pool.run('a', { weight: 1 });
    const queued = pool.run('b', { weight: 1 });
    pool.destroy();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    await expect(pool.run('c', { weight: 1 })).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.weightInFlight).toBe(0);
  });
});

describe('poolSize', () => {
  it.each([
    [undefined, 1],
    [1, 1],
    [2, 1],
    [4, 3],
    [5, 4],
    [16, 4],
  ])('hardwareConcurrency %j → %d workers', (cores, expected) => {
    expect(poolSize(cores)).toBe(expected);
  });
});
