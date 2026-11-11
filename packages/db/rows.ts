/**
 * Row-conversion helpers shared by the query modules (dependency-free, so the
 * Worker entry may import them too). D1 returns JSON columns
 * as text and booleans as 0/1; a module converts its rows once, here-assisted,
 * so callers only ever see parsed values.
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

/** All rows of an executed statement, converted. */
export async function allRows<Db, Row>(stmt: D1PreparedStatement, convert: (row: Db) => Row): Promise<Row[]> {
  const { results } = await stmt.all<Db>();
  return results.map(convert);
}

/** The first row of an executed statement, converted, or null. */
export async function firstRow<Db, Row>(stmt: D1PreparedStatement, convert: (row: Db) => Row): Promise<Row | null> {
  const row = await stmt.first<Db>();
  return row ? convert(row) : null;
}

/** The rows of one result of a `batch()`, converted. */
export function batchRows<Db, Row>(result: D1Result<unknown> | undefined, convert: (row: Db) => Row): Row[] {
  return ((result?.results ?? []) as Db[]).map(convert);
}
