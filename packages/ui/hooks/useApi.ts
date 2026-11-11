import { useCallback, useEffect, useRef, useState } from 'react';

import { AppError } from '@repo/core/error';
import { objectToUrlSearchParams, type QueryParams } from '@repo/core/url';

import { notifyApiResponse } from './apiEvents';

/** The error half of the envelope `withErrorHandling` / `@repo/api/responses` produce. */
export type RequestError = {
  errorCode: string;
  error: string;
  details?: Record<string, unknown>;
};

export type ApiResult<T> = { data: T | null; error: RequestError | null };

export type UseApiReturn<T> = {
  data: T | null;
  loading: boolean;
  error: AppError | null;
  /** GET/DELETE: `body` becomes the query string. Otherwise JSON (FormData/Blob/string sent as-is). */
  execute: (body?: unknown, customOptions?: RequestInit) => Promise<ApiResult<T>>;
  abort: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
};

function mergeHeaders(a?: HeadersInit, b?: HeadersInit): Headers {
  const h = new Headers();
  if (a) new Headers(a).forEach((v, k) => h.set(k, v));
  if (b) new Headers(b).forEach((v, k) => h.set(k, v));
  return h;
}

function toRequestBody(body: unknown): { body: BodyInit | undefined; json: boolean } {
  if (body == null) return { body: undefined, json: false };
  if (typeof FormData !== 'undefined' && body instanceof FormData) return { body, json: false };
  if (body instanceof Blob || typeof body === 'string') return { body, json: false };
  return { body: JSON.stringify(body), json: true };
}

function fail<T>(errorCode: string, error: string, details?: Record<string, unknown>): ApiResult<T> {
  return { data: null, error: { errorCode, error, ...(details ? { details } : {}) } };
}

/**
 * The one client-side fetch hook. Speaks the server's envelope: `{ data }` on
 * success (unwrapped for you), `{ error, errorCode, details }` on failure.
 *
 * STABILITY (this is what effects depend on): `execute` changes identity only
 * when `url` changes. Options are read from a ref at call time, so an inline
 * `useApi(url, { method: 'POST' })` does NOT re-fire `useEffect([execute])`.
 * A new call aborts the previous one; an abort is never surfaced as `error`
 * (it resolves with errorCode ABORT_ERROR so a caller can tell, if it cares).
 */
export function useApi<T = unknown>(url: string, options: RequestInit = {}): UseApiReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const execute = useCallback(
    async (body?: unknown, customOptions?: RequestInit): Promise<ApiResult<T>> => {
      const opts = optionsRef.current;
      abortRef.current?.abort();

      const method = (customOptions?.method ?? opts.method ?? 'GET').toUpperCase();
      const queryLike = method === 'GET' || method === 'DELETE';
      const requestUrl = queryLike && body ? `${url}${objectToUrlSearchParams(body as QueryParams)}` : url;

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      const headers = mergeHeaders(opts.headers, customOptions?.headers);
      const payload = queryLike ? { body: undefined, json: false } : toRequestBody(body);
      if (payload.json && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

      try {
        const response = await fetch(requestUrl, {
          ...opts,
          ...customOptions,
          method,
          headers,
          body: payload.body,
          signal: controller.signal,
        });
        notifyApiResponse({ url: requestUrl, method, status: response.status, headers: response.headers });

        let json: unknown = null;
        try {
          json = await response.json();
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') throw e;
        }
        const envelope = (json ?? {}) as { data?: T; error?: string; errorCode?: string; details?: Record<string, unknown> };

        if (envelope.error) {
          const code = envelope.errorCode ?? 'HTTP_ERROR';
          setError(new AppError(envelope.error, code, envelope.details ?? null));
          return fail(code, envelope.error, envelope.details);
        }
        if (!response.ok) {
          const message = `HTTP error! Status: ${response.status}`;
          setError(new AppError(message, 'HTTP_ERROR', { status: response.status }));
          return fail('HTTP_ERROR', message, { status: response.status });
        }

        const result = (json && typeof json === 'object' && 'data' in json ? envelope.data : json) as T;
        setData(result);
        return { data: result, error: null };
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e?.name === 'AbortError') return fail('ABORT_ERROR', 'Fetch aborted');
        setError(e instanceof AppError ? e : new AppError(e?.message ?? 'Request failed', 'REQUEST_FAIL'));
        return fail(e?.code ?? 'REQUEST_FAIL', e?.message ?? 'Request failed');
      } finally {
        // Only the latest request owns `loading`.
        if (abortRef.current === controller) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [url],
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  // Abort in flight on unmount (and on StrictMode's dev double-mount).
  useEffect(() => abort, [abort]);

  return { data, loading, error, execute, abort, setData };
}
