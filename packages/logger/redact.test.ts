import { describe, expect, it, vi } from 'vitest';

import { createLogger, redactSensitive } from './index';

describe('redactSensitive', () => {
  it.each([
    ['password', { password: 'hunter2' }, { password: '[REDACTED]' }],
    ['camelCase key', { apiKey: 'k' }, { apiKey: '[REDACTED]' }],
    ['nested object', { cfg: { databaseUrl: 'https://user:pass@db.example' } }, { cfg: { databaseUrl: '[REDACTED]' } }],
    ['a whole secret object', { credentials: { user: 'a' } }, { credentials: '[REDACTED]' }],
    ['numeric counter', { total_tokens: 42 }, { total_tokens: 42 }],
    ['word-bounded (consider is not sid)', { consider: 'x' }, { consider: 'x' }],
    ['errorCode stays visible', { errorCode: 'NOT_FOUND' }, { errorCode: 'NOT_FOUND' }],
  ])('%s', (_label, input, expected) => {
    expect(redactSensitive(input)).toEqual(expected);
  });

  it('survives a cycle', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redactSensitive(a)).toEqual({ name: 'a', self: '[Circular]' });
  });
});

describe('createLogger json format', () => {
  it('writes one redacted record with merged fields', () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    createLogger({ name: 'test', format: 'json', sink }).info({ event: 'x', token: 't' });
    const record = JSON.parse(sink.info.mock.calls[0]?.[0] as string);
    expect(record).toMatchObject({ level: 'INFO', name: 'test', event: 'x', token: '[REDACTED]' });
  });
});
