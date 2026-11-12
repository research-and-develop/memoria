import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repo's migrations (`migrations/*.sql`) as statements, for the test harness (and, later, a
 * Docker database adapter). Node only: never imported by runtime code.
 */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/** `0001_init.sql`, `0002_…` — wrangler's naming, applied in numeric order. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

/** Every migration, in order, each split into statements. */
export function migrationStatements(dir: string = MIGRATIONS_DIR): { file: string; statements: string[] }[] {
  return migrationFiles(dir).map((file) => ({ file, statements: splitSqlStatements(readFileSync(path.join(dir, file), 'utf8')) }));
}

/**
 * Split a migration into statements: `--` comments dropped, split on a `;`
 * that ends a line. A `CREATE TRIGGER … BEGIN … END;` body is kept whole.
 * Deliberately simple — so a migration keeps one statement per `;`-terminated
 * line group, and never puts `;` + newline inside a string literal.
 */
export function splitSqlStatements(sql: string): string[] {
  const lines = sql.split(/\r?\n/).map((line) => line.replace(/--.*$/, ''));
  const out: string[] = [];
  let current: string[] = [];
  let inTrigger = false;
  for (const line of lines) {
    current.push(line);
    const text = current.join('\n').trim();
    if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(text)) inTrigger = true;
    const ends = inTrigger ? /\bEND\s*;\s*$/i.test(line) : /;\s*$/.test(line);
    if (ends) {
      out.push(text);
      current = [];
      inTrigger = false;
    }
  }
  const rest = current.join('\n').trim();
  if (rest) out.push(rest);
  return out;
}
