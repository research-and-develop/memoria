/**
 * Test-only helpers for route tests: requests that look like the browser's,
 * and an admin session to call admin routes with. The Cloudflare context and
 * the database are wired by each test file (`vi.mock('@opennextjs/cloudflare')`,
 * `useTestDb`).
 */
import { NextRequest } from 'next/server';
import { vi } from 'vitest';

import { createSession, sessionCookieName } from '@/lib/auth/session';

export const ORIGIN = 'http://localhost:3000';

export function jsonRequest(
  path: string,
  body?: unknown,
  init: { method?: string; headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
  const method = init.method ?? (body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'user-agent': 'vitest', ...(init.headers ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** A live session for `passwordHash` in the test D1, as a Cookie header value. */
export async function adminCookie(passwordHash: string, db: D1Database): Promise<string> {
  const { token } = await createSession({ passwordHash, userAgent: 'vitest' }, { db });
  return `${sessionCookieName(false)}=${token}`;
}

/**
 * Run `fn` with `Date` frozen mid-window (timers stay real, so D1 still answers).
 * For a test that fires N requests at a fixed-window rate limit: on the real
 * clock a run that starts at 20:59:59 crosses into a new window halfway and the
 * limit never trips.
 */
export async function atFixedTime<T>(fn: () => Promise<T>, iso = '2026-06-15T10:22:30.000Z'): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

/** Route params the way Next hands them in: a Promise. */
export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}
