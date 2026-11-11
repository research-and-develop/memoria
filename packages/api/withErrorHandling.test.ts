import { notFound } from 'next/navigation';
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { AppError } from '@repo/core/error';
import { setGlobalLogLevel, LogLevel } from '@repo/logger';

import { isDbInputError, publicErrorMessage } from './publicErrorMessage';
import { responseHeaders } from './responseHeaders';
import { withErrorHandling } from './withErrorHandling';

setGlobalLogLevel(LogLevel.silent);

describe('withErrorHandling', () => {
  it('returns the handler response untouched on success', async () => {
    const res = await withErrorHandling(async () => NextResponse.json({ data: 'ok' }))();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'ok' });
  });

  it('adds the headers set through responseHeaders() to a successful response only', async () => {
    const ok = await withErrorHandling(async () => {
      await Promise.resolve();
      responseHeaders()?.set('x-app-hint', '["/"]');
      return NextResponse.json({ data: 'ok' });
    })();
    expect(ok.headers.get('x-app-hint')).toBe('["/"]');

    const failed = await withErrorHandling(async () => {
      responseHeaders()?.set('x-app-hint', '["/"]');
      throw new AppError('x', 'CONFLICT');
    })();
    expect(failed.headers.has('x-app-hint')).toBe(false);
    expect(responseHeaders()).toBeNull();
  });

  it('keeps concurrent requests’ headers apart', async () => {
    const route = withErrorHandling(async (value: string) => {
      responseHeaders()?.set('x-value', value);
      await new Promise((r) => setTimeout(r, value === 'a' ? 10 : 0));
      return NextResponse.json({ data: responseHeaders()?.get('x-value') });
    });
    const [a, b] = await Promise.all([route('a'), route('b')]);
    expect([a.headers.get('x-value'), b.headers.get('x-value')]).toEqual(['a', 'b']);
  });

  it('uses details.status and strips it from the body', async () => {
    const res = await withErrorHandling(async () => {
      throw new AppError('Nothing to change', 'NOTHING_TO_CHANGE', { status: 409, hint: 'x' });
    })();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Nothing to change', errorCode: 'NOTHING_TO_CHANGE', details: { hint: 'x' } });
  });

  it.each([
    ['NOT_FOUND', 404],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['CONFLICT', 409],
    ['ANYTHING_ELSE', 400],
  ])('infers the status of %s as %i', async (code, status) => {
    const res = await withErrorHandling(async () => {
      throw new AppError('x', code);
    })();
    expect(res.status).toBe(status);
  });

  it('turns an unknown throw into a 500 with a reqId', async () => {
    const res = await withErrorHandling(async () => {
      throw new Error('boom');
    }, { route: 'GET /api/x' })();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { errorCode: string; details: { reqId: string; message: string } };
    expect(body.errorCode).toBe('SERVER_ERROR');
    expect(body.details.reqId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.details.message).toBe('boom');
  });

  it('rethrows Next control-flow signals', async () => {
    await expect(withErrorHandling(async () => notFound())()).rejects.toThrow();
  });
});

describe('publicErrorMessage', () => {
  it('keeps our own message', () => {
    expect(publicErrorMessage(new Error('This slug is already taken'), 'r')).toBe('This slug is already taken');
  });

  it.each([
    [
      'a unique violation',
      'D1_ERROR: UNIQUE constraint failed: site_settings.key: SQLITE_CONSTRAINT',
      'This record already exists (CONSTRAINT, ref abc).',
    ],
    [
      'a check violation',
      'D1_ERROR: CHECK constraint failed: ck_site_settings_value_json: SQLITE_CONSTRAINT',
      'A value failed a validation rule (CONSTRAINT, ref abc).',
    ],
    ['a type error', "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'", 'A value has the wrong format (D1, ref abc).'],
    ['an unknown D1 failure', 'D1_ERROR: no such table: secret_table: SQLITE_ERROR', 'A database error occurred (ERROR, ref abc).'],
  ])('replaces %s, keeping the class and ref', (_label, message, expected) => {
    expect(publicErrorMessage(new Error(message), 'abc')).toBe(expected);
  });
});

describe('isDbInputError', () => {
  it.each([
    ['D1_ERROR: UNIQUE constraint failed: site_settings.key: SQLITE_CONSTRAINT', true],
    ["D1_TYPE_ERROR: Type 'undefined' not supported", true],
    ['D1_ERROR: no such table: x: SQLITE_ERROR', false],
    ['UNIQUE constraint failed (our own words, not the database)', false],
  ])('%s -> %s', (message, expected) => {
    expect(isDbInputError(new Error(message))).toBe(expected);
  });
});
