import type { FetchLike } from '../mail/http';

/**
 * A scripted `fetch` for the HTTPS mail adapters' tests. Test-only.
 *
 *   const s = scriptedFetch();
 *   s.reply({ status: 201, body: { messageId: '<x@brevo>' } });
 *   await brevoMailer({ apiKey: 'k' }, s.fetch).send(message, { signal });
 *   s.requests[0];   // { url, method, headers (lower-case names), body (text) }
 *
 * Each request takes the next queued reply, else the `otherwise` handler's, else it rejects (and
 * is listed in `unexpected`). A reply is a response (`status`, a JSON or text `body`, `headers`),
 * `{ network: true }` (fetch rejects, like a DNS or connection failure) or `{ hang: true }` (never
 * answers; rejects when the request's signal aborts).
 */
export type ScriptedReply =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { network: true }
  | { hang: true };

export type RecordedRequest = { url: string; method: string; headers: Record<string, string>; body: string };

export type ScriptedFetch = {
  fetch: FetchLike;
  requests: RecordedRequest[];
  unexpected: RecordedRequest[];
  /** Queue replies, used in order. */
  reply(...replies: ScriptedReply[]): void;
  /** The reply when the queue is empty. */
  otherwise(handler: (request: RecordedRequest) => ScriptedReply): void;
  /** Resolves once `count` requests have been received. */
  received(count: number): Promise<void>;
};

function bodyText(body: RequestInit['body']): string {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  throw new Error('scriptedFetch: unsupported body type');
}

export function scriptedFetch(): ScriptedFetch {
  const queue: ScriptedReply[] = [];
  const requests: RecordedRequest[] = [];
  const unexpected: RecordedRequest[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  let fallback: ((request: RecordedRequest) => ScriptedReply) | null = null;

  const fetchFn: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const request: RecordedRequest = { url: input, method: init.method ?? 'GET', headers, body: bodyText(init.body) };
    requests.push(request);
    for (const waiter of waiters.filter((w) => requests.length >= w.count)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
    const reply = queue.shift() ?? fallback?.(request);
    if (!reply) {
      unexpected.push(request);
      throw new TypeError(`scriptedFetch: no reply scripted for ${request.method} ${request.url}`);
    }
    if ('network' in reply) throw new TypeError('scriptedFetch: network error');
    if ('hang' in reply) {
      return new Promise<Response>((_, reject) => {
        const signal = init.signal;
        const fail = () => reject(new DOMException('aborted', 'AbortError'));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      });
    }
    const text = reply.body === undefined ? null : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    const status = reply.status;
    // A Response cannot carry a body with these statuses.
    const bodyAllowed = status !== 204 && status !== 205 && status !== 304;
    return new Response(bodyAllowed ? text : null, { status, headers: reply.headers });
  };

  return {
    fetch: fetchFn,
    requests,
    unexpected,
    reply: (...replies) => {
      queue.push(...replies);
    },
    otherwise: (handler) => {
      fallback = handler;
    },
    received: (count) =>
      requests.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push({ count, resolve });
          }),
  };
}
