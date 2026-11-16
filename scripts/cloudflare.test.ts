import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configuredAccountId, CREDENTIALS_FILE, parseCredentialsFile, resolveCredentials, ROOT } from './cloudflare';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';
const FILE = `CLOUDFLARE_ACCOUNT_ID=${ID}\nCLOUDFLARE_API_TOKEN=tok_abc123\n`;

describe('parseCredentialsFile', () => {
  it.each([
    ['both keys', FILE, true],
    ['upper-case id, quotes, comments', `# Memoria\nCLOUDFLARE_ACCOUNT_ID="${ID.toUpperCase()}"\nCLOUDFLARE_API_TOKEN='tok_abc123'\n`, true],
    ['no token', `CLOUDFLARE_ACCOUNT_ID=${ID}\n`, false],
    ['a short id', 'CLOUDFLARE_ACCOUNT_ID=abc\nCLOUDFLARE_API_TOKEN=x\n', false],
    ['another key', `${FILE}TURNSTILE_SECRET_KEY=x\n`, false],
    ['the global API key', `${FILE}CLOUDFLARE_API_KEY=x\n`, false],
  ])('%s', (_name, text, ok) => {
    expect(parseCredentialsFile(text).ok).toBe(ok);
  });

  it('normalises the id', () => {
    expect(parseCredentialsFile(`CLOUDFLARE_ACCOUNT_ID=${ID.toUpperCase()}\nCLOUDFLARE_API_TOKEN=t\n`)).toEqual({ ok: true, value: { accountId: ID, apiToken: 't' } });
  });
});

describe('configuredAccountId', () => {
  it.each([
    [`{\n  "name": "memoria",\n  "account_id": "${ID}",\n}`, ID],
    [`{\n  // "account_id": "${ID}",\n}`, null],
    ['{\n  "name": "memoria"\n}', null],
    ['{\n  "account_id": "<yours>"\n}', null],
  ])('%#', (jsonc, expected) => {
    expect(configuredAccountId(jsonc)).toBe(expected);
  });
});

describe('resolveCredentials', () => {
  it.each([
    ['the file, matching the config', { fileText: FILE, env: {}, configAccountId: ID }, true],
    ['the file wins over a token exported for another project', { fileText: FILE, env: { CLOUDFLARE_API_TOKEN: 'other' }, configAccountId: ID }, true],
    ['no account_id in wrangler.jsonc', { fileText: FILE, env: {}, configAccountId: null }, false],
    ['the file names another account', { fileText: FILE, env: {}, configAccountId: OTHER }, false],
    ['no file, a global token, not CI', { fileText: null, env: { CLOUDFLARE_API_TOKEN: 'other' }, configAccountId: ID }, false],
    ['no file, nothing (the global wrangler login is never used)', { fileText: null, env: {}, configAccountId: ID }, false],
    ['CI with its secrets', { fileText: null, env: { CI: 'true', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: ID }, configAccountId: ID }, true],
    ['CI without the account id: the config one', { fileText: null, env: { CI: 'true', CLOUDFLARE_API_TOKEN: 't' }, configAccountId: ID }, true],
    ['CI with another account id', { fileText: null, env: { CI: 'true', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: OTHER }, configAccountId: ID }, false],
  ])('%s', (_name, input, ok) => {
    const result = resolveCredentials(input);
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.value.accountId).toBe(ID);
  });
});

describe(`${CREDENTIALS_FILE}`, () => {
  it('is gitignored and not a name Next or OpenNext reads (.env, .env.<mode>, .env.local)', () => {
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/)).toContain(CREDENTIALS_FILE);
    expect(CREDENTIALS_FILE.startsWith('.env')).toBe(false);
  });
});
