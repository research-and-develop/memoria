import { NextResponse } from 'next/server';

/**
 * The error envelope: `{ error, errorCode, details? }`. Success is always
 * `{ data, ...paging }`. Use these builders (or throw an AppError) instead of
 * hand-building `NextResponse.json({ error }, { status })`.
 */

export function jsonError(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export function unauthorizedError(details?: Record<string, unknown>) {
  return jsonError(401, { error: 'Unauthorized', errorCode: 'UNAUTHORIZED', ...(details ? { details } : {}) });
}

export function forbiddenError(details?: Record<string, unknown>) {
  return jsonError(403, { error: 'Forbidden', errorCode: 'FORBIDDEN', ...(details ? { details } : {}) });
}

export function notFoundError(details?: Record<string, unknown>) {
  return jsonError(404, { error: 'Not found', errorCode: 'NOT_FOUND', ...(details ? { details } : {}) });
}

export function invalidParamsError(message: string, field?: string, extras?: Record<string, unknown>) {
  return jsonError(400, {
    error: 'Invalid parameters',
    errorCode: 'INVALID_PARAMS',
    details: { message, ...(field ? { field } : {}), ...(extras ?? {}) },
  });
}

export function serverError(message?: string) {
  return jsonError(500, {
    error: 'Server error',
    errorCode: 'SERVER_ERROR',
    ...(message ? { details: { message } } : {}),
  });
}

/**
 * 429 with a `Retry-After` header. `message` is the user-facing text the form
 * shows (`details.message`).
 */
export function tooManyRequestsError(retryAfterSeconds: number, message: string) {
  const res = jsonError(429, {
    error: 'Too many requests',
    errorCode: 'RATE_LIMITED',
    details: { message, retryAfterSeconds },
  });
  res.headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return res;
}
