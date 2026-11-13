/**
 * Guard: the env DEFAULTS of studio-level settings (`Config.bootstrap`: the
 * studio name, the website address, the env sign-in account) are read only by
 * the modules that apply the fallback rule "D1, else env, else the default"
 * (plan p02b, D2b.2–3): `lib/auth/account.ts` and `lib/settings/**`.
 *
 * Anything else reading `config().bootstrap` would ignore what the
 * photographer saved in the studio, e.g. sign in with an env password that the
 * studio replaced. Tests and the platform's own parsing are exempt; scripts
 * may read env directly (they run outside the Worker).
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ROOTS = ['apps/web', 'packages'];
const ALLOWED = [
  /^packages\/platform\/config\.ts$/,
  /^packages\/platform\/testing\//,
  /^apps\/web\/src\/lib\/settings\//,
  /^apps\/web\/src\/lib\/auth\/account\.ts$/,
];

/** `.bootstrap` (any receiver, `?.` too) or a destructured `{ bootstrap }`. */
const BOOTSTRAP_RE = /\??\.\s*bootstrap\b|\{[^{}]*\bbootstrap\b[^{}]*\}\s*=(?!=)/;

export function readsBootstrap(source: string): boolean {
  return BOOTSTRAP_RE.test(stripComments(source));
}

const isAllowed = (file: string) => ALLOWED.some((re) => re.test(file.replace(/\\/g, '/')));

describe('studio-level env defaults are read only through the settings modules', () => {
  const files = readSourceFiles({ roots: ROOTS, extensions: ['.ts', '.tsx', '.mjs'], includeTests: false });

  it('scans the source and finds the allowed readers (else it passes for the wrong reason)', () => {
    expect(files.length).toBeGreaterThan(50);
    const readers = files.filter((f) => readsBootstrap(f.text)).map((f) => f.path.replace(/\\/g, '/'));
    expect(readers).toEqual(expect.arrayContaining(['apps/web/src/lib/auth/account.ts', 'apps/web/src/lib/settings/studio.ts']));
  });

  it('finds no other reader', () => {
    const offenders = files.filter((f) => readsBootstrap(f.text) && !isAllowed(f.path)).map((f) => f.path);
    expect(
      offenders,
      'Read the studio name / website address with readStudio() (lib/settings/studio.ts) and the account with ' +
        'readAdminAccount() (lib/auth/account.ts): a value saved in the studio wins over env:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it.each([
    ['getPlatform().config().bootstrap.appName', true],
    ['const c = getPlatform().config(); c.bootstrap', true],
    ['config?.bootstrap?.siteUrl', true],
    ['const { bootstrap } = getPlatform().config();', true],
    ['const { bootstrap: b, admin } = config;', true],
    ['// config().bootstrap is the default', false],
    ['bootstrap: { appName: x }', false],
    ['const bootstrapped = true; x.bootstrapped', false],
  ])('matcher: %s → %s', (sample, expected) => {
    expect(readsBootstrap(sample)).toBe(expected);
  });

  it('allows exactly the settings modules', () => {
    expect(isAllowed('apps/web/src/lib/settings/studio.ts')).toBe(true);
    expect(isAllowed('apps\\web\\src\\lib\\auth\\account.ts')).toBe(true);
    expect(isAllowed('apps/web/src/lib/auth/requireAdmin.ts')).toBe(false);
    expect(isAllowed('apps/web/src/app/layout.tsx')).toBe(false);
  });
});
