import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { logger } from '@repo/logger';
import type { Db } from '@repo/platform/ports';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { readBranding } from './branding';
import { readGalleryDefaults } from './galleryDefaults';
import { BRANDING_DEFAULTS } from './parseBrandingInput';
import { GALLERY_DEFAULTS } from './parseGalleryDefaultsInput';

/** The branding and gallery-defaults readers on a test D1 (plan p04 D4.2): one file, one D1. */
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestPlatform();
  await testDb.reset();
});
afterAll(() => testDb.dispose());

const save = (key: string, value: unknown) => run(statement('INSERT INTO site_settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]), { db: testDb.db });

describe.each([
  { name: 'readBranding', key: 'branding', read: readBranding, defaults: BRANDING_DEFAULTS, valid: { ...BRANDING_DEFAULTS, accent: 'navy', theme: 'dark' }, invalid: { theme: 'sepia' }, field: 'theme' },
  {
    name: 'readGalleryDefaults',
    key: 'gallery_defaults',
    read: readGalleryDefaults,
    defaults: GALLERY_DEFAULTS,
    valid: { ...GALLERY_DEFAULTS, purpose: 'sharing', access: 'password' },
    invalid: { delivery: 'protected' },
    field: 'delivery',
  },
])('$name', ({ key, read, defaults, valid, invalid, field }) => {
  it('no row → the built-in defaults', async () => {
    useTestPlatform({ db: testDb.db });
    expect(await read()).toEqual(defaults);
  });

  it('a valid row wins', async () => {
    useTestPlatform({ db: testDb.db });
    await save(key, valid);
    expect(await read()).toEqual(valid);
  });

  it('an invalid row → the defaults and one log line naming the field', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    useTestPlatform({ db: testDb.db });
    await save(key, invalid);
    expect(await read()).toEqual(defaults);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: `${key}_settings_invalid`, field });
  });

  it('never throws: a failing database logs and uses the defaults', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    useTestPlatform({ db: { first: () => Promise.reject(new Error('D1 down')) } as unknown as Db });
    expect(await read()).toEqual(defaults);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: `${key}_settings_unavailable` }));
  });

  it('returns a fresh copy (a caller editing it cannot change the defaults)', async () => {
    useTestPlatform({ db: testDb.db });
    const first = (await read()) as Record<string, unknown>;
    first.purpose = 'changed';
    first.theme = 'changed';
    expect(await read()).toEqual(defaults);
  });
});

it('a stored branding row naming a removed swatch reads it as Pine', async () => {
  useTestPlatform({ db: testDb.db });
  await save('branding', { accent: 'retired', theme: 'light' });
  expect(await readBranding()).toEqual({ ...BRANDING_DEFAULTS, theme: 'light' });
});
