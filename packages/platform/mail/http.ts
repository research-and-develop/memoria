import { MailError } from './error';

/**
 * What the HTTPS mail adapters (Brevo, SES, Microsoft 365) share: one request with the caller's
 * abort signal and the send timeout, and the `Retry-After` header. Pure apart from `fetch`, which
 * every adapter takes as a parameter (the global one in production, a scripted one in tests).
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The whole send: it fires before the job runner's 20 s cap, so the outcome is a clear timeout. */
export const SEND_TIMEOUT_MS = 18_000;

/**
 * `fetch` that rejects with `MAIL_ABORTED` when `signal` aborts, `<prefix>_TIMEOUT` after
 * `timeoutMs`, and `<prefix>_NETWORK` when the request itself fails (all transient).
 */
export async function mailFetch(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  opts: { signal: AbortSignal; prefix: string; timeoutMs?: number },
): Promise<Response> {
  if (opts.signal.aborted) throw new MailError('MAIL_ABORTED');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  opts.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? SEND_TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) throw new MailError(`${opts.prefix}_TIMEOUT`);
    if (opts.signal.aborted) throw new MailError('MAIL_ABORTED');
    throw new MailError(`${opts.prefix}_NETWORK`);
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
  }
}

/** `Retry-After` in seconds (a number of seconds or an HTTP date), else undefined. */
export function retryAfterSeconds(response: Response, now: Date = new Date()): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/** The response body as JSON, or null (an empty or non-JSON body). Never throws. */
export async function jsonBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A string field of an object, or undefined. */
export function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}
