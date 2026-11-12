import { describe, expect, it } from 'vitest';

import { migrationFiles, migrationStatements, splitSqlStatements } from './migrations';

describe('splitSqlStatements', () => {
  it.each([
    ['one statement', 'CREATE TABLE a (x TEXT);', ['CREATE TABLE a (x TEXT);']],
    ['comments dropped', '-- note\nCREATE TABLE a (x TEXT); -- trailing\n', ['CREATE TABLE a (x TEXT);']],
    ['multi-line statements', 'CREATE TABLE a (\n  x TEXT\n);\nCREATE INDEX ix_a ON a (x);', ['CREATE TABLE a (\n  x TEXT\n);', 'CREATE INDEX ix_a ON a (x);']],
    [
      'a trigger body stays whole',
      'CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET x = 1;\n  UPDATE a SET x = 2;\nEND;\nSELECT 1;',
      ['CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE a SET x = 1;\n  UPDATE a SET x = 2;\nEND;', 'SELECT 1;'],
    ],
  ])('%s', (_label, input, expected) => {
    expect(splitSqlStatements(input)).toEqual(expected);
  });
});

describe('the repo migrations', () => {
  it('are found in order, each with statements', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/^0001_/);
    expect(migrationStatements().every((m) => m.statements.length > 0)).toBe(true);
  });
});
