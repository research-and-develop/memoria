import { describe, expect, it } from 'vitest';

import { deriveGalleryKeys } from '@/lib/edge/gallery/access';

import { gateDailyRule, gateFailureRule, GATE_IP_RULE, passwordsMatch } from './gate';

describe('passwordsMatch (HMAC both, constant-time compare)', () => {
  it.each([
    ['the same password', 'maple-river-42', 'maple-river-42', true],
    ['another password', 'maple-river-43', 'maple-river-42', false],
    ['a prefix', 'maple', 'maple-river-42', false],
    ['a longer one', 'maple-river-42!', 'maple-river-42', false],
    ['case differs', 'Maple-River-42', 'maple-river-42', false],
    ['Cyrillic', 'клен-река-42', 'клен-река-42', true],
  ])('%s → %s', async (_label, supplied, stored, expected) => {
    const { access } = await deriveGalleryKeys(new Uint8Array(32).fill(1));
    expect(await passwordsMatch(access, supplied, stored)).toBe(expected);
  });
});

describe('the gate rules', () => {
  it('fit the rate_limits bucket (≤ 120 characters) and name what they count', () => {
    const ip = 'a'.repeat(32);
    const id = '9a11e700-0000-4000-8000-000000000001';
    for (const rule of [GATE_IP_RULE(ip), gateFailureRule(ip, id), gateDailyRule(id, 999)]) expect(rule.bucket.length).toBeLessThanOrEqual(120);
    expect(GATE_IP_RULE(ip)).toMatchObject({ limit: 30, windowSeconds: 60 });
    expect(gateFailureRule(ip, id)).toMatchObject({ limit: 10, windowSeconds: 900 });
    expect(gateDailyRule(id, 1).bucket).not.toBe(gateDailyRule(id, 2).bucket);
  });
});
