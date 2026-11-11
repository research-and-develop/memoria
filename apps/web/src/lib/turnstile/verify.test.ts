import { describe, expect, it, vi } from 'vitest';

import { verifyTurnstile } from './verify';

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const base = { token: 'tok', secret: 'real-secret', action: 'login' as const, hostname: 'example.com' };

describe('verifyTurnstile', () => {
  it('passes a valid token for the right action and hostname, and sends the secret and IP', async () => {
    const fetchImpl = reply({ success: true, action: 'login', hostname: 'example.com' });
    expect(await verifyTurnstile({ ...base, remoteIp: '203.0.113.7', fetchImpl })).toEqual({ ok: true });
    const body = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].body as FormData;
    expect(body.get('secret')).toBe('real-secret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it.each([
    ['no token', { token: '' }, { success: true }, 'missing_token'],
    ['no secret', { secret: '' }, { success: true }, 'not_configured'],
    ['a rejected token', {}, { success: false, 'error-codes': ['invalid-input-response'] }, 'rejected'],
    ['a token for another form', {}, { success: true, action: 'other-form', hostname: 'example.com' }, 'wrong_action'],
    ['a token from another site', {}, { success: true, action: 'login', hostname: 'evil.example' }, 'wrong_hostname'],
  ])('refuses %s', async (_label, patch, response, reason) => {
    expect(await verifyTurnstile({ ...base, ...patch, fetchImpl: reply(response) })).toEqual({ ok: false, reason });
  });

  it('fails closed when Cloudflare is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile({ ...base, fetchImpl })).toEqual({ ok: false, reason: 'unavailable' });
    expect(await verifyTurnstile({ ...base, fetchImpl: reply({}, 500) })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it("accepts Cloudflare's test secret without action/hostname (local dev)", async () => {
    const fetchImpl = reply({ success: true, hostname: 'example.com' });
    expect(await verifyTurnstile({ ...base, secret: '1x0000000000000000000000000000000AA', fetchImpl })).toEqual({ ok: true });
  });
});
