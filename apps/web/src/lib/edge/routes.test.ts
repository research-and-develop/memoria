import { describe, expect, it } from 'vitest';

import { HEALTH_PATH, edgeResponse } from './routes';

const env = { CF_VERSION_METADATA: { id: 'v-123' } };

describe('edgeResponse', () => {
  it('answers the health probe with the running version, uncached', async () => {
    const res = edgeResponse(new Request(`https://x.test${HEALTH_PATH}`), env);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('cache-control')).toBe('no-store');
    expect(await res?.json()).toEqual({ data: { status: 'ok', version: 'v-123' } });
  });

  it('answers HEAD without a body', async () => {
    const res = edgeResponse(new Request(`https://x.test${HEALTH_PATH}`, { method: 'HEAD' }), env);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('');
  });

  it.each([
    ['another path', 'https://x.test/', 'GET'],
    ['a POST to the probe', `https://x.test${HEALTH_PATH}`, 'POST'],
    ['a sub-path', `https://x.test${HEALTH_PATH}/x`, 'GET'],
  ])('hands %s to Next', (_label, url, method) => {
    expect(edgeResponse(new Request(url, { method }), env)).toBeNull();
  });
});
