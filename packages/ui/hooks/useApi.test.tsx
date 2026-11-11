import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onApiResponse } from './apiEvents';
import { useApi } from './useApi';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApi', () => {
  it('unwraps { data } on success', async () => {
    mockFetch(200, { data: [{ id: 'a' }] });
    const { result } = renderHook(() => useApi<{ id: string }[]>('/api/admin/things'));

    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute();
    });

    expect(outcome).toEqual({ data: [{ id: 'a' }], error: null });
    expect(result.current.data).toEqual([{ id: 'a' }]);
    expect(result.current.error).toBeNull();
  });

  it('tells the response listeners about every response, and a throwing listener breaks nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: 1 }), { headers: { 'x-app-hint': '["/"]' } })));
    const seen: string[] = [];
    const stops = [
      onApiResponse(() => {
        throw new Error('listener bug');
      }),
      onApiResponse((info) => seen.push(`${info.method} ${info.url} ${info.status} ${info.headers.get('x-app-hint')}`)),
    ];
    const { result } = renderHook(() => useApi('/api/admin/sections/home.weekly', { method: 'PUT' }));
    let outcome: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      outcome = await result.current.execute({});
    });
    stops.forEach((stop) => stop());
    expect(outcome).toEqual({ data: 1, error: null });
    expect(seen).toEqual(['PUT /api/admin/sections/home.weekly 200 ["/"]']);
  });

  it('surfaces the error envelope', async () => {
    mockFetch(400, { error: 'Invalid parameters', errorCode: 'INVALID_PARAMS', details: { field: 'name' } });
    const { result } = renderHook(() => useApi('/api/admin/things', { method: 'POST' }));

    await act(async () => {
      await result.current.execute({ name: '' });
    });

    expect(result.current.error?.code).toBe('INVALID_PARAMS');
    expect(result.current.error?.details).toEqual({ field: 'name' });
  });

  it('sends GET params as a query string and POST bodies as JSON', async () => {
    const fetchMock = mockFetch(200, { data: null });
    const { result } = renderHook(() => useApi('/api/admin/things'));

    await act(async () => {
      await result.current.execute({ page: 2 });
      await result.current.execute({ name: 'W' }, { method: 'POST' });
    });

    const [first, second] = fetchMock.mock.calls as unknown as [[string, RequestInit], [string, RequestInit]];
    expect(first[0]).toBe('/api/admin/things?page=2');
    expect(second[1].body).toBe('{"name":"W"}');
    expect(new Headers(second[1].headers).get('content-type')).toBe('application/json');
  });

  it('keeps execute stable across renders with inline options', () => {
    const { result, rerender } = renderHook(() => useApi('/api/admin/things', { method: 'GET' }));
    const first = result.current.execute;
    rerender();
    expect(result.current.execute).toBe(first);
  });
});
