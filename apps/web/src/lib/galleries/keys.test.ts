import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isBlobKey } from '@repo/platform/media';

import { displayKey, newRev, originalKey, photoKeys, randomString, REV_RE, thumbKey } from './keys';

const G = '9a11e700-0000-4000-8000-000000000001';
const P = '9d070500-0000-4000-8000-000000000002';

describe('keys', () => {
  it('builds the three keys of a photo under galleries/, all valid blob keys', () => {
    const keys = photoKeys({ id: P, gallery_id: G, content_type: 'image/png', rev: 'abcd2345', derivative_ext: 'jpg' });
    expect(keys).toEqual({
      original: `galleries/${G}/${P}/original.png`,
      thumb: `galleries/${G}/${P}/abcd2345/thumb.jpg`,
      display: `galleries/${G}/${P}/abcd2345/display.jpg`,
    });
    for (const key of Object.values(keys)) expect(isBlobKey(key)).toBe(true);
    expect(originalKey(G, P, 'image/jpeg')).toMatch(/original\.jpg$/);
    expect(thumbKey(G, P, 'zzzz2222', 'webp')).toMatch(/zzzz2222\/thumb\.webp$/);
    expect(displayKey(G, P, 'zzzz2222', 'webp')).toMatch(/display\.webp$/);
  });

  it('mints revs and random strings of [a-z2-9], every character reachable', () => {
    for (let i = 0; i < 200; i += 1) expect(newRev()).toMatch(REV_RE);
    const long = randomString(5000);
    expect(long).toMatch(/^[a-z2-9]{5000}$/);
    expect(new Set(long).size).toBe(34);
  });

  it('has no imports at all (the relay, worker.ts and the browser build the same keys)', () => {
    expect(readFileSync(new URL('./keys.ts', import.meta.url), 'utf8')).not.toMatch(/^\s*import\s/m);
  });
});
