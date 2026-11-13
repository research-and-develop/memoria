import { describe, expect, it } from 'vitest';

import { d1Args, describeAccount, parseArgs, parseD1Output, remoteDatabaseId, remotePlan } from './admin-mfa';

describe('admin:mfa arguments', () => {
  it.each([
    [['setup'], { command: 'setup', remote: false, yes: false, email: null }],
    [['reset', '--remote'], { command: 'reset', remote: true, yes: false, email: null }],
    [['--remote', 'unlock', '--yes'], { command: 'unlock', remote: true, yes: true, email: null }],
    [['list', '-y'], { command: 'list', remote: false, yes: true, email: null }],
    [['key'], { command: 'key', remote: false, yes: false, email: null }],
    [['password'], { command: 'password', remote: false, yes: false, email: null }],
    [['password', '--email', ' Owner@Example.com ', '--remote'], { command: 'password', remote: true, yes: false, email: 'owner@example.com' }],
    [['password', '--email=owner@example.com'], { command: 'password', remote: false, yes: false, email: 'owner@example.com' }],
  ])('%j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it.each([
    [[]],
    [['nope']],
    [['setup', 'reset']],
    [['setup', '--force']],
    [['key', '--remote']],
    [['password', '--email']],
    [['password', '--email', "o'wner@example.com"]],
    [['password', '--email', 'not-an-email']],
    [['setup', '--email', 'owner@example.com']],
  ])('refuses %j', (argv) => {
    expect(parseArgs(argv)).toHaveProperty('error');
  });
});

describe('--remote', () => {
  it('is refused while database_id is the all-zeros placeholder', () => {
    expect(remoteDatabaseId('"database_id": "00000000-0000-0000-0000-000000000000",')).toBeNull();
    expect(remoteDatabaseId('{ "d1_databases": [] }')).toBeNull();
    expect(remoteDatabaseId('"database_id": "3f1c2a9e-1111-4a2b-9c3d-123456789abc"')).toBe('3f1c2a9e-1111-4a2b-9c3d-123456789abc');
  });

  it('says what it will do before asking', () => {
    expect(remotePlan('reset')).toMatch(/PRODUCTION.*signed out/);
    expect(remotePlan('password')).toMatch(/PRODUCTION.*signed out/);
    expect(remotePlan('list')).toMatch(/Read/);
  });

  it('builds wrangler arguments: --remote --yes only for production, one --command', () => {
    expect(d1Args(['SELECT 1', 'SELECT 2'], false)).toEqual(['d1', 'execute', 'DB', '--local', '--json', '--command', 'SELECT 1;\nSELECT 2']);
    expect(d1Args(['SELECT 1'], true)).toEqual(['d1', 'execute', 'DB', '--remote', '--json', '--yes', '--command', 'SELECT 1']);
  });
});

describe('parseD1Output', () => {
  it('reads the JSON after any banner wrangler prints', () => {
    expect(parseD1Output('▲ [WARNING] something\n[{"results":[{"a":1}],"success":true}]')).toEqual([{ results: [{ a: 1 }], success: true }]);
    expect(() => parseD1Output('no json')).toThrow(/no JSON/);
  });
});

describe('describeAccount', () => {
  it('names the account and who set its password, or says there is none', () => {
    expect(describeAccount(undefined)).toMatch(/none in the database/);
    expect(describeAccount({ email: 'owner@example.com', set_by: 'cli', updated_at: '2026-11-13T10:00:00.000Z' })).toBe(
      'Account: owner@example.com (database, password set by the command line, 2026-11-13 10:00)',
    );
  });
});
