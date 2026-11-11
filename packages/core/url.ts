type QueryValue = string | number | boolean;
export type QueryParams = Record<string, QueryValue | QueryValue[] | null | undefined>;

/**
 * `{ page: 2, status: ['a', 'b'], q: null }` -> `?page=2&status=a&status=b`.
 * Arrays repeat the key, null/undefined are dropped, `''` when nothing is left.
 * URL query params are underscore_case by convention (`page_size`, not `pageSize`).
 */
export function objectToUrlSearchParams(params: QueryParams): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(key, String(item));
    } else if (value !== null && value !== undefined) {
      searchParams.append(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}
