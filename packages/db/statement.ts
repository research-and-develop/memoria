import type { SqlValue, Statement } from '@repo/platform/ports';

/**
 * `statement()`, IMPORT-FREE (type imports only; plan p06 D6.6), so code `worker.ts` reaches can build
 * statements: the public read builders (`lib/db/queries/<table>/public.ts`) import it from here, never
 * from `@repo/db/client` (which imports `server-only` and the composition root). `@repo/db/client`
 * re-exports it, so every other caller keeps importing it from there. Guard: `edge-graph`.
 */

/** A statement: SQL and its parameters, frozen. The unit `batch()` takes. Executes nothing. */
export function statement(sql: string, params: readonly SqlValue[] = []): Statement {
  params.forEach((value: unknown, i) => {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`statement parameter ${i} is ${value === undefined ? 'undefined' : typeof value}: bind a string, a number or null`);
    }
  });
  return Object.freeze({ sql, params: Object.freeze([...params]) });
}
