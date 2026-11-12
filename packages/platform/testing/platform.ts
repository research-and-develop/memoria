import { parseConfig, type StringEnv } from '../config';
import { memoryBlobStore } from '../memory/blobStore';
import type { BlobStore, Config, Db, Platform } from '../ports';

/**
 * The test platform: what `getPlatform()` returns under vitest (vitest.config.ts aliases
 * `@repo/platform/current` to ./current.ts). Test-only.
 *
 *   beforeEach(() => useTestPlatform({ db: testDb.db, env: { ADMIN_EMAIL: 'a@b.c' } }));
 *   afterEach(() => resetTestPlatform());
 *   …
 *   await flushDeferred();   // the work routes handed to `defer`
 *
 * - `config()` parses the given `env` object on EVERY call, so a test may change it mid-test.
 * - `blobs` defaults to a fresh in-memory store; `db()` throws until a db is installed
 *   (`useTestDb(testDb.db)` from @repo/db/test-utils, or `useTestPlatform({ db })`).
 * - `defer(task)` handles the task's rejection at once (no unhandled rejection) and records it;
 *   `flushDeferred()` awaits every recorded task and rethrows the first failure.
 *
 * State lives on `globalThis`: the alias and a relative import may load this module twice.
 */

type State = {
  env: Record<string, string | undefined>;
  db: Db | null;
  blobs: BlobStore;
  deferred: Promise<{ ok: true } | { ok: false; error: unknown }>[];
};

const KEY = Symbol.for('memoria.platform.test');
type Holder = { [KEY]?: State };
const holder = globalThis as Holder;

function fresh(): State {
  return { env: {}, db: null, blobs: memoryBlobStore(), deferred: [] };
}

function state(): State {
  holder[KEY] ??= fresh();
  return holder[KEY];
}

/** Install the test platform's parts for the current test. Anything not given is reset to its default. */
export function useTestPlatform(parts: { db?: Db | null; env?: Record<string, string | undefined>; blobs?: BlobStore } = {}): void {
  holder[KEY] = { ...fresh(), env: parts.env ?? {}, db: parts.db ?? null, blobs: parts.blobs ?? memoryBlobStore() };
}

/** Set or clear only the database (the other parts stay). */
export function setTestDb(db: Db | null): void {
  state().db = db;
}

/** Back to the defaults: empty env, a fresh memory store, no db, nothing deferred. */
export function resetTestPlatform(): void {
  holder[KEY] = fresh();
}

/** Await everything handed to `defer` so far; rethrow the first failure. */
export async function flushDeferred(): Promise<void> {
  const s = state();
  const outcomes = await Promise.all(s.deferred);
  s.deferred = [];
  const failed = outcomes.find((o) => !o.ok);
  if (failed && !failed.ok) throw failed.error;
}

export const testPlatform: Platform = {
  name: 'test',
  db(): Db {
    const db = state().db;
    if (!db) throw new Error('no test db: call useTestDb(testDb.db) or useTestPlatform({ db }), or pass { db }');
    return db;
  },
  blobs: () => state().blobs,
  config: (): Config => parseConfig(state().env as StringEnv),
  defer(task: Promise<unknown>): void {
    state().deferred.push(task.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    ));
  },
};
