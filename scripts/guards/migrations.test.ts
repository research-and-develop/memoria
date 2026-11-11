/**
 * Guard: the migrations follow the house conventions (AGENTS.md → Data rules).
 *
 *   - files are `NNNN_<snake_case>.sql`, numbered 1..n without gaps (wrangler
 *     applies by name; a gap usually means a lost or renamed file);
 *   - every constraint, index and trigger is NAMED with its prefix
 *     (pk_/fk_/uq_/ck_, ix_/uq_, tr_) — an unnamed one gets an
 *     `sqlite_autoindex_…` name, and an error message nobody can trace;
 *   - no transaction control: D1 rejects BEGIN/COMMIT — a migration file is
 *     already applied atomically;
 *   - no `;` at the end of a line inside a string literal: the test harness
 *     (packages/db/test-utils.ts) splits statements there.
 *
 * Comments are stripped the way the harness strips them (`--` to end of line).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '@repo/core/testing/sourceIndex';

const DIR = path.join(repoRoot(), 'migrations');
const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

const stripSqlComments = (sql: string) => sql.split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');

/** Names that break the prefix rule. */
export function namingProblems(sql: string): string[] {
  const text = stripSqlComments(sql);
  const problems: string[] = [];
  for (const [, name = ''] of text.matchAll(/\bCONSTRAINT\s+(\w+)/gi)) {
    if (!/^(pk|fk|uq|ck)_/.test(name)) problems.push(`constraint ${name}: name it pk_/fk_/uq_/ck_…`);
  }
  for (const [, unique, name = ''] of text.matchAll(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    const ok = unique ? /^(uq|ix)_/.test(name) : /^ix_/.test(name);
    if (!ok) problems.push(`index ${name}: name it ${unique ? 'uq_/ix_' : 'ix_'}…`);
  }
  for (const [, name = ''] of text.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    if (!/^tr_/.test(name)) problems.push(`trigger ${name}: name it tr_…`);
  }
  return problems;
}

/** The comma-separated items of each `CREATE TABLE x (…)` body and `ADD COLUMN` clause. */
function columnItems(text: string): string[] {
  const items: string[] = [];
  for (const m of text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s*\(/gi)) {
    let depth = 1;
    let current = '';
    for (let i = (m.index ?? 0) + m[0].length; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if ((ch === ',' && depth === 1) || depth === 0) {
        items.push(current.trim());
        current = '';
      } else current += ch;
    }
  }
  for (const [, column = ''] of text.matchAll(/\bADD\s+COLUMN\s+([^;]+);/gi)) items.push(column.trim());
  return items;
}

/** Column definitions carrying a constraint without `CONSTRAINT <name>`. */
export function unnamedConstraints(sql: string): string[] {
  return columnItems(stripSqlComments(sql))
    .filter((item) => !/^CONSTRAINT\b/i.test(item))
    .filter((item) => /\b(PRIMARY\s+KEY|UNIQUE|CHECK|REFERENCES)\b/i.test(item) && !/\bCONSTRAINT\s+\w+/i.test(item))
    .map((item) => `unnamed constraint in "${item.split('\n')[0]}"`);
}

export function transactionControl(sql: string): string[] {
  const re = /^\s*(BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?|COMMIT(\s+TRANSACTION)?|END\s+TRANSACTION|ROLLBACK)\s*;/gim;
  return [...stripSqlComments(sql).matchAll(re)].map((m) => `transaction control "${m[1]}": D1 rejects it`);
}

/** Line numbers where a string literal holds `;` + newline (the harness would split there). */
export function semicolonNewlineInString(sql: string): number[] {
  const text = stripSqlComments(sql);
  const lines: number[] = [];
  let inString = false;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') line++;
    if (ch === "'") inString = !inString;
    if (inString && ch === ';' && /^[ \t]*\r?\n/.test(text.slice(i + 1))) lines.push(line);
  }
  return lines;
}

describe('migrations', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

  it('finds the migrations', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('are named NNNN_<snake_case>.sql and numbered without gaps', () => {
    expect(files.filter((f) => !FILE_RE.test(f))).toEqual([]);
    expect(files.map((f) => Number(f.slice(0, 4)))).toEqual(files.map((_, i) => i + 1));
  });

  it('follow the naming, constraint, transaction and string rules', () => {
    const offenders = files.flatMap((f) => {
      const sql = readFileSync(path.join(DIR, f), 'utf8');
      return [
        ...namingProblems(sql),
        ...unnamedConstraints(sql),
        ...transactionControl(sql),
        ...semicolonNewlineInString(sql).map((n) => `line ${n}: ';' + newline inside a string literal`),
      ].map((p) => `${f}: ${p}`);
    });
    expect(offenders).toEqual([]);
  });
});

describe('the checks catch the mistakes they are for', () => {
  const good = `CREATE TABLE a (
  id TEXT NOT NULL, -- PRIMARY KEY in a comment is fine
  b_id TEXT CONSTRAINT fk_a_b REFERENCES b (id),
  n INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT pk_a PRIMARY KEY (id),
  CONSTRAINT ck_a_n CHECK (n IN (0, 1))
);
CREATE UNIQUE INDEX uq_a_n ON a (n);
CREATE INDEX ix_a_b ON a (b_id);
CREATE TRIGGER tr_a_insert AFTER INSERT ON a
BEGIN
  UPDATE a SET n = 1;
END;`;

  it('accepts the house style', () => {
    expect([...namingProblems(good), ...unnamedConstraints(good), ...transactionControl(good), ...semicolonNewlineInString(good)]).toEqual([]);
  });

  it.each([
    ['an unprefixed constraint', 'CREATE TABLE a (id TEXT, CONSTRAINT a_pkey PRIMARY KEY (id));', namingProblems],
    ['an unprefixed index', 'CREATE INDEX a_n ON a (n);', namingProblems],
    ['an unprefixed trigger', 'CREATE TRIGGER a_ins AFTER INSERT ON a BEGIN SELECT 1; END;', namingProblems],
    ['an inline primary key', 'CREATE TABLE a (id TEXT PRIMARY KEY, n INTEGER);', unnamedConstraints],
    ['an inline foreign key', 'CREATE TABLE a (b_id TEXT REFERENCES b (id));', unnamedConstraints],
    ['an added column with a check', "ALTER TABLE a ADD COLUMN s TEXT CHECK (s IN ('x'));", unnamedConstraints],
    ['a transaction', 'BEGIN TRANSACTION;\nCREATE TABLE a (x TEXT);\nCOMMIT;', transactionControl],
  ])('flags %s', (_label, sql, check: (s: string) => unknown[]) => {
    expect(check(sql).length).toBeGreaterThan(0);
  });

  it("flags ';' + newline inside a string", () => {
    expect(semicolonNewlineInString("INSERT INTO a VALUES ('x;\ny');")).toEqual([1]);
    expect(semicolonNewlineInString("INSERT INTO a VALUES ('x;y');\nSELECT 1;")).toEqual([]);
  });
});
