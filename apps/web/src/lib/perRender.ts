import * as React from 'react';

/**
 * React's `cache()`: one call per server render. Next runs server components on
 * its own React 19 server build, which has it; the repo's React 18.3.1 (vitest,
 * the client bundle) has none, so there it is a plain pass-through. Server
 * components only: in a route handler it would not cache anyway (read once and
 * pass the value on instead).
 */
export function perRender<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const cache = (React as unknown as { cache?: (f: (...args: A) => R) => (...args: A) => R }).cache;
  return cache ? cache(fn) : fn;
}
