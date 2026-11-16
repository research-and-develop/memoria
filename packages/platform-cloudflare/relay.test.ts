import { describe, expect, it } from 'vitest';

import type { Platform } from '@repo/platform/ports';
import { testPlatform } from '@repo/platform/testing/platform';

import { getPlatform, withPlatform } from './relay';

const another = (): Platform => ({ ...testPlatform });
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the relay composition root', () => {
  it('getPlatform() outside withPlatform() throws', () => {
    expect(() => getPlatform()).toThrow(/outside withPlatform/);
  });

  it('overlapping invocations each see their own platform across awaits', async () => {
    const platforms = [another(), another(), another()];
    const seen = await Promise.all(
      platforms.map((platform, i) =>
        withPlatform(platform, async () => {
          const before = getPlatform();
          await tick(15 - i * 5); // finish in the reverse order
          await Promise.resolve();
          return [before, getPlatform()];
        }),
      ),
    );
    seen.forEach(([before, after], i) => {
      expect(before).toBe(platforms[i]);
      expect(after).toBe(platforms[i]);
    });
    expect(() => getPlatform()).toThrow();
  });

  it('returns what the function returns and passes its rejection on', async () => {
    await expect(withPlatform(another(), async () => 42)).resolves.toBe(42);
    await expect(withPlatform(another(), async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
