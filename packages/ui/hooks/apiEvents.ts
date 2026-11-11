/**
 * A hook into every `useApi` response, for app-wide reactions to what the
 * server says in headers (e.g. the admin warming the pages a save changed)
 * without each caller knowing. A listener sees the response's status and
 * headers; it must not read the body (useApi does).
 *
 * The listener set lives on `globalThis`, so duplicated module copies share it.
 */
export type ApiResponseInfo = { url: string; method: string; status: number; headers: Headers };
export type ApiResponseListener = (info: ApiResponseInfo) => void;

const LISTENERS_KEY = '__repoApiResponseListeners';

function listeners(): Set<ApiResponseListener> {
  const holder = globalThis as unknown as Record<string, Set<ApiResponseListener> | undefined>;
  holder[LISTENERS_KEY] ??= new Set();
  return holder[LISTENERS_KEY];
}

/** Subscribe; returns the unsubscribe (an effect's cleanup). */
export function onApiResponse(listener: ApiResponseListener): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}

/** Called by useApi after each response. A throwing listener never breaks the request. */
export function notifyApiResponse(info: ApiResponseInfo): void {
  for (const listener of listeners()) {
    try {
      listener(info);
    } catch {
      // a listener's bug is not the request's failure
    }
  }
}
