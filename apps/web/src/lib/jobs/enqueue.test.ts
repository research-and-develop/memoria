import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushDeferred, nudgeCount, resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { jobStatement, MAX_PAYLOAD_BYTES, nudgeRelay } from './enqueue';
import type { JobKind } from './types';

beforeEach(() => useTestPlatform());
afterEach(() => resetTestPlatform());

const greeting: JobKind<{ to: string }> = {
  kind: 'test.greeting',
  version: 2,
  maxAttempts: 4,
  priority: 1,
  backoff: [1],
  parse: (p) => (typeof p.to === 'string' && p.v === 2 ? { ok: true, value: { to: p.to } } : { ok: false, unknown: false }),
  run: async () => {},
};
const NOW = new Date('2026-11-16T10:00:00.000Z');

describe('jobStatement', () => {
  it('adds v, takes the kind’s priority and attempts, and is due now unless told otherwise', () => {
    const { id, statement } = jobStatement(greeting as JobKind<unknown>, { to: 'x' }, { now: NOW, ref: 'gallery:1', id: 'job-1' });
    expect(id).toBe('job-1');
    expect(statement.params).toEqual(['job-1', 'test.greeting', '{"to":"x","v":2}', 1, 4, NOW.toISOString(), 'gallery:1', null, NOW.toISOString(), NOW.toISOString()]);
    const later = jobStatement(greeting as JobKind<unknown>, { to: 'x' }, { now: NOW, runAfter: new Date('2026-11-17T00:00:00.000Z') });
    expect(later.statement.params[5]).toBe('2026-11-17T00:00:00.000Z');
    expect(later.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a payload its kind does not parse, and one over 8 KB', () => {
    expect(() => jobStatement(greeting as JobKind<unknown>, { to: 1 }, { now: NOW })).toThrow(/does not parse/);
    expect(() => jobStatement(greeting as JobKind<unknown>, { to: 'x'.repeat(MAX_PAYLOAD_BYTES) }, { now: NOW })).toThrow(/over/);
  });
});

describe('nudgeRelay', () => {
  it('defers one nudge', async () => {
    nudgeRelay();
    await flushDeferred();
    expect(nudgeCount()).toBe(1);
  });
});
