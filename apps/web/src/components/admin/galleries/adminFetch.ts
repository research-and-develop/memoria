/**
 * The manager's requests (many URLs per screen: a set, a page, a bulk action), speaking the API
 * envelope like `useApi`: `{ data, …paging }` on success, `{ error, errorCode, details }` on failure.
 * Returns the user-facing sentence (`details.message`) as `error`, never throws. Same-origin JSON.
 */
export type AdminResult<T> = { ok: true; data: T; body: Record<string, unknown> } | { ok: false; error: string; code: string; field?: string };

export async function adminFetch<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<AdminResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && 'data' in body) return { ok: true, data: body.data as T, body };
    const details = (body.details ?? {}) as { message?: string; field?: string };
    return {
      ok: false,
      error: details.message ?? (typeof body.error === 'string' && res.status < 500 ? body.error : 'Something went wrong. Try again.'),
      code: typeof body.errorCode === 'string' ? body.errorCode : `HTTP_${res.status}`,
      field: details.field,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, error: '', code: 'ABORT_ERROR' };
    return { ok: false, error: 'The connection failed. Try again.', code: 'NETWORK_ERROR' };
  }
}
