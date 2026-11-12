import type { BatchResult, Db, Statement, WriteResult } from '@repo/platform/ports';

/**
 * The Db port on a D1 binding (the Worker's `env.DB`, or a miniflare proxy of it in tests).
 * Statements arrive as plain data and are prepared and bound here, at execution.
 */

function prepare(binding: D1Database, s: Statement): D1PreparedStatement {
  const prepared = binding.prepare(s.sql);
  return s.params.length ? prepared.bind(...s.params) : prepared;
}

export function d1Db(binding: D1Database): Db {
  return {
    async all<T>(s: Statement): Promise<T[]> {
      const { results } = await prepare(binding, s).all<T>();
      return results;
    },

    first<T>(s: Statement): Promise<T | null> {
      return prepare(binding, s).first<T>();
    },

    async run(s: Statement): Promise<WriteResult> {
      const { meta } = await prepare(binding, s).run();
      return { changes: meta?.changes ?? 0, lastRowId: meta?.last_row_id ?? null };
    },

    async batch<T>(statements: readonly Statement[]): Promise<BatchResult<T>[]> {
      if (statements.length === 0) return [];
      const results = await binding.batch<T>(statements.map((s) => prepare(binding, s)));
      return results.map((r) => ({ rows: r.results ?? [], changes: r.meta?.changes ?? 0 }));
    },
  };
}
