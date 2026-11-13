/**
 * `npm run admin:mfa -- <command> [--remote] [--yes]`: the developer's controls
 * for two-factor sign-in (plan p02 → The CLI). Local D1 by default; `--remote`
 * for production (needs `wrangler login`).
 *
 *   list     the account, authenticators, recovery codes, live sessions, a live setup code, the lockout
 *   password a new generated password for the account (plan p02b); `--email <address>` also sets
 *            the email, and is required while there is no account in the database
 *   setup    a one-time setup code to enrol the FIRST authenticator (valid 1 hour)
 *   reset    remove every authenticator, recovery code, challenge and session; print a new setup code
 *   unlock   clear the sign-in lockout (and the sign-in rate limits)
 *   key      print a new TOTP_ENCRYPTION_KEY (no database)
 *
 * It runs wrangler's own script with node (an argument array, no shell), so
 * the SQL reaches `wrangler d1 execute DB --command` exactly as built. The SQL
 * comes from apps/web/src/lib/db/queries/admin_two_factor_cli/sql.ts.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { parseEmailAddress } from '../packages/core/email';
import { generatePassword } from '../apps/web/src/lib/auth/generatePassword';
import { hashPassword } from '../apps/web/src/lib/auth/password';
import { generateSetupCode, normaliseSetupCode, SETUP_CODE_TTL_MS, setupCodeId } from '../apps/web/src/lib/auth/setupCode';
import { listStatements, passwordStatements, resetStatements, setupStatements, unlockStatements } from '../apps/web/src/lib/db/queries/admin_two_factor_cli/sql';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');

export const COMMANDS = ['list', 'password', 'setup', 'reset', 'unlock', 'key'] as const;
export type Command = (typeof COMMANDS)[number];
/** `email`: only with `password` (lower-cased); null = keep the account's. */
export type Args = { command: Command; remote: boolean; yes: boolean; email: string | null };

const USAGE = 'Usage: npm run admin:mfa -- <list|password|setup|reset|unlock|key> [--email <address>] [--remote] [--yes]';

export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const rest: string[] = [];
  let email: string | null | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--email' || arg.startsWith('--email=')) {
      const value = arg === '--email' ? argv[++i] : arg.slice('--email='.length);
      const parsed = parseEmailAddress(value ?? '');
      if (!parsed) return { error: `--email needs a valid email address. ${USAGE}` };
      email = parsed.toLowerCase();
    } else {
      rest.push(arg);
    }
  }
  const flags = rest.filter((a) => a.startsWith('-'));
  const words = rest.filter((a) => !a.startsWith('-'));
  const unknown = flags.filter((f) => f !== '--remote' && f !== '--yes' && f !== '-y');
  if (unknown.length) return { error: `Unknown option ${unknown.join(', ')}. ${USAGE}` };
  if (words.length !== 1 || !COMMANDS.includes(words[0] as Command)) return { error: USAGE };
  const command = words[0] as Command;
  const remote = flags.includes('--remote');
  if (command === 'key' && remote) return { error: '`key` does not touch a database: drop --remote.' };
  if (email !== undefined && command !== 'password') return { error: '--email goes with `password` only.' };
  return { command, remote, yes: flags.includes('--yes') || flags.includes('-y'), email: email ?? null };
}

/** The D1 database_id in wrangler.jsonc, or null while it is the all-zeros placeholder (no production D1 yet). */
export function remoteDatabaseId(wranglerJsonc: string): string | null {
  const id = wranglerJsonc.match(/"database_id"\s*:\s*"([^"]*)"/)?.[1] ?? '';
  return id && !/^[0-]+$/.test(id) ? id : null;
}

/** What a `--remote` run will do, shown before asking for confirmation. */
export function remotePlan(command: Exclude<Command, 'key'>): string {
  switch (command) {
    case 'list':
      return 'Read the two-factor state of the PRODUCTION database.';
    case 'password':
      return 'Replace the sign-in password in the PRODUCTION database with a new one (everyone is signed out).';
    case 'setup':
      return 'Store a new setup code in the PRODUCTION database (only if no authenticator is registered).';
    case 'reset':
      return 'Remove EVERY authenticator, recovery code and session from the PRODUCTION database (everyone is signed out), then store a new setup code.';
    case 'unlock':
      return 'Clear the sign-in lockout and rate limits in the PRODUCTION database.';
  }
}

/** The arguments for wrangler's script: one `--command` with the statements joined. */
export function d1Args(statements: readonly string[], remote: boolean): string[] {
  return ['d1', 'execute', 'DB', remote ? '--remote' : '--local', '--json', ...(remote ? ['--yes'] : []), '--command', statements.join(';\n')];
}

type StatementOutput = { results?: Record<string, unknown>[]; success?: boolean };

export function parseD1Output(stdout: string): StatementOutput[] {
  // A line that opens a JSON array of objects (a banner like "[WARNING]" is not one).
  const start = stdout.search(/^\[\s*(\{|\])/m);
  if (start === -1) throw new Error(`wrangler printed no JSON:\n${stdout}`);
  return JSON.parse(stdout.slice(start)) as StatementOutput[];
}

function runD1(statements: readonly string[], remote: boolean): StatementOutput[] {
  const wrangler = path.join(path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  const out = spawnSync(process.execPath, [wrangler, ...d1Args(statements, remote)], { cwd: WEB, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (out.status !== 0) {
    throw new Error(`wrangler d1 execute failed (exit ${out.status}):\n${out.stderr || out.stdout}`);
  }
  return parseD1Output(out.stdout);
}

function newKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

async function storeSetupCode(remote: boolean, reset: boolean): Promise<void> {
  const code = generateSetupCode();
  const id = await setupCodeId(normaliseSetupCode(code) ?? '');
  const expiresAt = new Date(Date.now() + SETUP_CODE_TTL_MS).toISOString();
  const statements = reset ? resetStatements({ auditId: crypto.randomUUID(), setupCodeId: id, expiresAt }) : setupStatements({ setupCodeId: id, expiresAt });
  const results = runD1(statements, remote);
  const stored = Number(results.at(-1)?.results?.[0]?.stored ?? 0);
  if (!stored) {
    console.log('Two-factor is already set up: an authenticator is registered. To start over, use `npm run admin:mfa -- reset`.');
    process.exitCode = 1;
    return;
  }
  if (reset) console.log('Removed every authenticator, recovery code and session.');
  console.log(`\nSetup code (valid 1 hour, until ${expiresAt.slice(11, 16)} UTC):\n\n    ${code}\n`);
  console.log('Sign in with the email and password, then enter this code to connect an authenticator app.');
}

async function setPassword(email: string | null, remote: boolean): Promise<void> {
  const password = generatePassword();
  const statements = passwordStatements({ email, passwordHash: await hashPassword(password), auditId: crypto.randomUUID(), now: new Date().toISOString() });
  const stored = runD1(statements, remote).at(-1)?.results?.[0]?.email;
  if (typeof stored !== 'string') {
    console.log('No account in the database yet: pass --email <address> to create it.');
    process.exitCode = 1;
    return;
  }
  console.log(`\nSign-in for ${stored} (every device is signed out):\n\n    email:    ${stored}\n    password: ${password}\n`);
  console.log('Give this to the photographer; they choose their own in Settings → Security.');
  console.log('This password is shown once and not stored anywhere else.');
  console.log(`Sign-in also needs TOTP_ENCRYPTION_KEY on the Worker and an authenticator (\`npm run admin:mfa -- setup${remote ? ' --remote' : ''}\` for the first one).`);
}

export function describeAccount(row: Record<string, unknown> | undefined): string {
  if (!row?.email) return 'Account: none in the database (ADMIN_EMAIL / ADMIN_PASSWORD_HASH from env are used if set)';
  const who = row.set_by === 'cli' ? 'the command line' : row.set_by === 'studio' ? 'the photographer' : 'env (carried over)';
  return `Account: ${String(row.email)} (database, password set by ${who}, ${String(row.updated_at).slice(0, 16).replace('T', ' ')})`;
}

function printList(results: StatementOutput[]): void {
  const rows = (i: number) => results[i]?.results ?? [];
  console.log(describeAccount(rows(5)[0]));
  const apps = rows(0);
  console.log(`Authenticator apps: ${apps.length}`);
  for (const a of apps) console.log(`  - ${String(a.label)}  (added ${String(a.created_at).slice(0, 10)}, last used ${a.last_used_at ? String(a.last_used_at).slice(0, 16).replace('T', ' ') : 'never'})`);
  const codes = rows(1)[0] ?? {};
  console.log(`Recovery codes: ${Number(codes.unused ?? 0)} unused of ${Number(codes.total ?? 0)}`);
  const sessions = rows(2);
  console.log(`Live sessions: ${sessions.length}`);
  for (const s of sessions) {
    console.log(`  - ${String(s.second_factor)}, ${s.country ? `${String(s.country)}, ` : ''}signed in ${String(s.created_at).slice(0, 16).replace('T', ' ')}, last active ${String(s.last_seen_at).slice(0, 16).replace('T', ' ')}`);
  }
  const setup = rows(3)[0]?.expires_at;
  console.log(`Setup code: ${setup ? `live until ${String(setup).slice(0, 16).replace('T', ' ')} UTC` : 'none'}`);
  const failures = Number(rows(4)[0]?.failures ?? 0);
  console.log(`Wrong codes today: ${failures}${failures >= 20 ? ' (sign-in is LOCKED: npm run admin:mfa -- unlock)' : ''}`);
}

async function confirm(command: string, plan: string): Promise<boolean> {
  console.log(`${plan}\nType "${command}" to continue:`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('> ')).trim() === command;
  } finally {
    rl.close();
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if ('error' in args) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }
  if (args.command === 'key') {
    console.log(newKey());
    console.log('\nLocally: TOTP_ENCRYPTION_KEY=<that> in apps/web/.dev.vars. Production: npx wrangler secret put TOTP_ENCRYPTION_KEY (in apps/web).');
    console.log('Changing the key disables every authenticator: run `npm run admin:mfa -- reset` afterwards.');
    return;
  }
  if (args.remote) {
    if (!remoteDatabaseId(readFileSync(path.join(WEB, 'wrangler.jsonc'), 'utf8'))) {
      console.error('No production D1 yet (database_id in apps/web/wrangler.jsonc is all zeros). See docs/deployment.md.');
      process.exitCode = 1;
      return;
    }
    if (!args.yes && !(await confirm(args.command, remotePlan(args.command)))) {
      console.log('Nothing done.');
      return;
    }
  }
  const where = args.remote ? 'production' : 'local';
  switch (args.command) {
    case 'list': {
      const now = new Date();
      printList(runD1(listStatements({ now: now.toISOString(), dayStart: `${now.toISOString().slice(0, 10)}T00:00:00.000Z` }), args.remote));
      return;
    }
    case 'password':
      return setPassword(args.email, args.remote);
    case 'setup':
      return storeSetupCode(args.remote, false);
    case 'reset':
      return storeSetupCode(args.remote, true);
    case 'unlock':
      runD1(unlockStatements(), args.remote);
      console.log(`Sign-in unlocked (${where}).`);
      return;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
