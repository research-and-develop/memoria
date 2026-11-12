/**
 * Row-conversion helpers shared by the query modules. PURE and import-free, so
 * `types.ts` files and the Worker entry may import them. SQLite returns JSON
 * columns as text and booleans as 0/1; a module converts its rows once,
 * here-assisted, so callers only ever see parsed values. The helpers that
 * execute a statement (`allRows`, `firstRow`) live in @repo/db/client.
 */

/** `[]`-defaulted JSON array of strings (chips, facts, groups). Anything else reads as empty. */
export function readStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function readJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const toBool = (value: number | boolean | null | undefined): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): 0 | 1 => (value ? 1 : 0);

/** The rows of one result of a `batch()` (a `BatchResult`), converted. */
export function batchRows<DbRow, Row>(result: { readonly rows: readonly unknown[] } | undefined, convert: (row: DbRow) => Row): Row[] {
  return ((result?.rows ?? []) as DbRow[]).map(convert);
}
