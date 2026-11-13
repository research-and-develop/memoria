import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { run, statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';
import { logger } from '@repo/logger';
import type { Db } from '@repo/platform/ports';
import { resetTestPlatform, useTestPlatform } from '@repo/platform/testing/platform';

import { parseSiteUrl, parseStudioInput, parseStudioName } from './parseStudioInput';
import { readStudio } from './studio';

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

const saveStudio = (value: string) => run(statement("INSERT INTO site_settings (key, value) VALUES ('studio', ?)", [value]), { db: testDb.db });

describe('readStudio', () => {
  it('defaults to Memoria and the request origin', async () => {
    useTestPlatform({ db: testDb.db });
    expect(await readStudio()).toEqual({ name: 'Memoria', siteUrl: null });
  });

  it('uses APP_NAME and SITE_URL while there is no row', async () => {
    useTestPlatform({ db: testDb.db, env: { APP_NAME: 'North Light', SITE_URL: 'https://photos.example.com/' } });
    expect(await readStudio()).toEqual({ name: 'North Light', siteUrl: 'https://photos.example.com' });
  });

  it('prefers the row; a stored empty address falls back to SITE_URL', async () => {
    useTestPlatform({ db: testDb.db, env: { APP_NAME: 'Env', SITE_URL: 'https://env.example.com' } });
    await saveStudio(JSON.stringify({ name: 'Saved', siteUrl: 'https://saved.example.com' }));
    expect(await readStudio()).toEqual({ name: 'Saved', siteUrl: 'https://saved.example.com' });
    await run(statement("UPDATE site_settings SET value = ? WHERE key = 'studio'", [JSON.stringify({ name: 'Saved', siteUrl: null })]), { db: testDb.db });
    expect(await readStudio()).toEqual({ name: 'Saved', siteUrl: 'https://env.example.com' });
  });

  it('ignores and logs an invalid row', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    useTestPlatform({ db: testDb.db, env: { APP_NAME: 'Env' } });
    await saveStudio(JSON.stringify({ name: '', siteUrl: null }));
    expect(await readStudio()).toEqual({ name: 'Env', siteUrl: null });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'studio_settings_invalid' }));
  });

  it('never throws: a failing database logs and uses the env defaults', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const broken = { first: () => Promise.reject(new Error('D1 down')) } as unknown as Db;
    useTestPlatform({ db: broken, env: { APP_NAME: 'Env' } });
    expect(await readStudio()).toEqual({ name: 'Env', siteUrl: null });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'studio_settings_unavailable' }));
  });
});

describe('parseStudioName', () => {
  it.each([
    ['  North Light  ', 'North Light'],
    ['Café Studio', 'Café Studio'],
    ['Студио Светлина', 'Студио Светлина'],
    ['x'.repeat(80), 'x'.repeat(80)],
  ])('accepts %j', (input, expected) => {
    expect(parseStudioName(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['empty', '   '],
    ['81 characters', 'x'.repeat(81)],
    ['a control character', 'North\u0007Light'],
    ['a zero-width space', 'North​Light'],
    ['a bidi override', 'North‮Light'],
    ['not a string', 42],
  ])('refuses %s', (_name, input) => {
    expect(parseStudioName(input).ok).toBe(false);
  });
});

describe('parseSiteUrl', () => {
  const prod = { isDevelopment: false };
  const dev = { isDevelopment: true };
  it.each([
    ['photos.example.com', prod, 'https://photos.example.com'],
    ['https://Photos.Example.com/', prod, 'https://photos.example.com'],
    ['https://photos.example.com:8443', prod, 'https://photos.example.com:8443'],
    ['', prod, null],
    ['  ', prod, null],
    [null, prod, null],
    ['http://localhost:3210', dev, 'http://localhost:3210'],
  ])('%j → %j', (input, opts, expected) => {
    expect(parseSiteUrl(input, opts)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['http outside development', 'http://photos.example.com', prod],
    ['http to a real host in development', 'http://photos.example.com', dev],
    ['localhost outside development', 'https://localhost', prod],
    ['a path', 'photos.example.com/gallery', prod],
    ['a query', 'https://photos.example.com/?a=1', prod],
    ['an empty query', 'https://photos.example.com/?', prod],
    ['a fragment', 'https://photos.example.com/#top', prod],
    ['credentials', 'https://user:pw@photos.example.com', prod],
    ['another scheme', 'ftp://photos.example.com', prod],
    ['no dot', 'photos', prod],
    ['garbage', 'https://', prod],
  ])('refuses %s', (_name, input, opts) => {
    expect(parseSiteUrl(input, opts).ok).toBe(false);
  });
});

describe('parseStudioInput', () => {
  it('names the failing field', () => {
    expect(parseStudioInput({ name: '', siteUrl: '' }, { isDevelopment: false })).toMatchObject({ ok: false, field: 'name' });
    expect(parseStudioInput({ name: 'A', siteUrl: 'http://x.com' }, { isDevelopment: false })).toMatchObject({ ok: false, field: 'siteUrl' });
    expect(parseStudioInput({ name: 'A', siteUrl: 'x.com' }, { isDevelopment: false })).toEqual({ ok: true, value: { name: 'A', siteUrl: 'https://x.com' } });
  });
});
