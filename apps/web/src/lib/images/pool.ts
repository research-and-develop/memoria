/**
 * A pool of Web Workers with a weight budget (plan p05 D5.5): at most `size` tasks run at once, and
 * the summed `weight` of running tasks (decoded megapixels) stays within `maxWeight` — except that a
 * task heavier than the budget may run alone, or it would wait forever. FIFO: a heavy task at the
 * head waits for room rather than being overtaken. Workers start lazily and are reused.
 *
 * Cancellation: a queued task is dropped; a running one terminates its worker (the only way to stop
 * a decode), which is replaced on the next task. A crashed worker fails its task and is replaced.
 *
 * The protocol: the pool posts `{ id, input }`; the worker answers `{ id, ok: true, output }` or
 * `{ id, ok: false, error }`.
 */

export type WorkerLike = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type WorkerReply<O> = { id: number; ok: true; output: O } | { id: number; ok: false; error: string };

export type RunOptions = { weight: number; signal?: AbortSignal; transfer?: Transferable[] };

export type Pool<I, O> = {
  run(input: I, options: RunOptions): Promise<O>;
  /** The summed weight of the running tasks. */
  readonly weightInFlight: number;
  readonly running: number;
  readonly queued: number;
  /** Terminate every worker and reject every task. */
  destroy(): void;
};

type Task<I, O> = {
  id: number;
  input: I;
  options: RunOptions;
  resolve: (output: O) => void;
  reject: (error: unknown) => void;
  onAbort?: () => void;
};

type Slot<I, O> = { worker: WorkerLike | null; task: Task<I, O> | null };

const abortError = () => new DOMException('Processing cancelled', 'AbortError');

export function createPool<I, O>(createWorker: () => WorkerLike, { size, maxWeight }: { size: number; maxWeight: number }): Pool<I, O> {
  const slots: Slot<I, O>[] = Array.from({ length: Math.max(1, size) }, () => ({ worker: null, task: null }));
  const queue: Task<I, O>[] = [];
  let weightInFlight = 0;
  let nextId = 1;
  let destroyed = false;

  const runningCount = () => slots.filter((s) => s.task).length;

  function detach(task: Task<I, O>) {
    if (task.onAbort) task.options.signal?.removeEventListener('abort', task.onAbort);
  }

  /** The slot's task is over (answered, failed or cancelled): free its budget and start more. */
  function finish(slot: Slot<I, O>): Task<I, O> | null {
    const task = slot.task;
    if (!task) return null;
    slot.task = null;
    weightInFlight -= task.options.weight;
    detach(task);
    return task;
  }

  function kill(slot: Slot<I, O>) {
    slot.worker?.terminate();
    slot.worker = null;
  }

  function spawn(slot: Slot<I, O>): WorkerLike {
    const worker = createWorker();
    worker.onmessage = (event) => {
      const reply = event.data as WorkerReply<O>;
      if (slot.worker !== worker || slot.task?.id !== reply?.id) return;
      const task = finish(slot);
      if (reply.ok) task?.resolve(reply.output);
      else task?.reject(new Error(reply.error));
      pump();
    };
    worker.onerror = () => {
      if (slot.worker !== worker) return;
      kill(slot);
      finish(slot)?.reject(new Error('The image worker stopped unexpectedly'));
      pump();
    };
    return worker;
  }

  function fits(task: Task<I, O>) {
    return runningCount() === 0 || weightInFlight + task.options.weight <= maxWeight;
  }

  function pump() {
    while (!destroyed && queue.length > 0) {
      const head = queue[0]!;
      const slot = slots.find((s) => !s.task);
      if (!slot || !fits(head)) return;
      queue.shift();
      slot.task = head;
      weightInFlight += head.options.weight;
      slot.worker ??= spawn(slot);
      slot.worker.postMessage({ id: head.id, input: head.input }, head.options.transfer ?? []);
    }
  }

  return {
    run(input, options) {
      return new Promise<O>((resolve, reject) => {
        if (destroyed || options.signal?.aborted) return reject(abortError());
        const task: Task<I, O> = { id: nextId++, input, options, resolve, reject };
        task.onAbort = () => {
          const at = queue.indexOf(task);
          if (at !== -1) {
            queue.splice(at, 1);
            return reject(abortError());
          }
          const slot = slots.find((s) => s.task === task);
          if (!slot) return;
          kill(slot); // the only way to stop a decode in progress
          finish(slot);
          reject(abortError());
          pump();
        };
        options.signal?.addEventListener('abort', task.onAbort, { once: true });
        queue.push(task);
        pump();
      });
    },
    get weightInFlight() {
      return weightInFlight;
    },
    get running() {
      return runningCount();
    },
    get queued() {
      return queue.length;
    },
    destroy() {
      destroyed = true;
      for (const slot of slots) {
        kill(slot);
        finish(slot)?.reject(abortError());
      }
      for (const task of queue.splice(0)) {
        detach(task);
        task.reject(abortError());
      }
    },
  };
}
