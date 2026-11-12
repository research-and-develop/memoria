import { describe, expect, it } from 'vitest';

import { d1Args, parseArgs, parseD1Output, remoteDatabaseId, remotePlan } from './admin-mfa';

describe('admin:mfa arguments', () => {
  it.each([
    [['setup'], { command: 'setup', remote: false, yes: false }],
    [['reset', '--remote'], { command: 'reset', remote: true, yes: false }],
    [['--remote', 'unlock', '--yes'], { command: 'unlock', remote: true, yes: true }],
    [['list', '-y'], { command: 'list', remote: false, yes: true }],
    [['key'], { command: 'key', remote: false, yes: false }],
  ])('%j', (argv, expected) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it.each([[[]], [['nope']], [['setup', 'reset']], [['setup', '--force']], [['key', '--remote']]])('refuses %j', (argv) => {
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
