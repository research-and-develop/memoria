import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Headers a route's response should carry, added from deep inside the work a
 * route delegates (e.g. "these pages changed", set where the change is made)
 * without threading them back through every return value. `withErrorHandling`
 * opens one bag per request and copies it onto a successful response.
 *
 * `node:async_hooks` rather than a Web API: request-scoped state needs
 * AsyncLocalStorage (Workers provide it under `nodejs_compat`; Next uses it too).
 * One store per process, on `globalThis` (Next's server build duplicates modules).
 */
const STORE_KEY = '__repoResponseHeaders';

function store(): AsyncLocalStorage<Headers> {
  const holder = globalThis as unknown as Record<string, AsyncLocalStorage<Headers> | undefined>;
  holder[STORE_KEY] ??= new AsyncLocalStorage<Headers>();
  return holder[STORE_KEY];
}

/** Run `fn` with an empty bag; its contents are returned with the result. */
export async function withResponseHeaders<T>(fn: () => Promise<T>): Promise<{ result: T; headers: Headers }> {
  const headers = new Headers();
  const result = await store().run(headers, fn);
  return { result, headers };
}

/** The current route's bag, or null outside a route (a script, a test calling a helper directly). */
export function responseHeaders(): Headers | null {
  return store().getStore() ?? null;
}
