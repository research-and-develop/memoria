/**
 * The inbox's query string (`?page=2&page_size=20` — URL params are
 * underscore_case). Pure; a malformed value is a 400, never a silent default.
 */
export type InboxQuery = { page: number; pageSize: number };
export type ParseInboxQueryResult = { ok: true; value: InboxQuery } | { ok: false; field: string; message: string };

const POSITIVE_INT = /^[1-9]\d{0,5}$/;

export function parseInboxQuery(params: URLSearchParams): ParseInboxQueryResult {
  const page = params.get('page') ?? '1';
  const pageSize = params.get('page_size') ?? '20';
  if (!POSITIVE_INT.test(page)) return { ok: false, field: 'page', message: 'page must be a positive integer' };
  if (!POSITIVE_INT.test(pageSize) || Number(pageSize) > 100) return { ok: false, field: 'page_size', message: 'page_size must be 1–100' };
  return { ok: true, value: { page: Number(page), pageSize: Number(pageSize) } };
}
