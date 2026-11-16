/**
 * Runs a command against THIS project's Cloudflare account, never the global
 * `wrangler login` (which may belong to another project on this machine).
 *
 *   npm run wrangler -- <wrangler args>        wrangler, run from apps/web
 *   tsx scripts/cloudflare.ts npm <args>       an npm script (deploy, db:migrate:remote)
 *   tsx scripts/cloudflare.ts node <args>      a node script (measure:cpu)
 *
 * The credentials come from `.cloudflare.env` at the repo root (gitignored):
 *
 *   CLOUDFLARE_ACCOUNT_ID=<32 hex characters>
 *   CLOUDFLARE_API_TOKEN=<an account API token>
 *
 * Deliberately not `.env`/`.env.local`/`.env.production`: Next and OpenNext read
 * those (in apps/web AND the repo root) and OpenNext bakes them into the Worker.
 * Without the file, only CI may use CLOUDFLARE_API_TOKEN from the environment
 * (GitHub secrets); a token exported globally for another project is refused.
 * The account id must equal `account_id` in apps/web/wrangler.jsonc, so a
 * command cannot reach another account even with the wrong token.
 * docs/deployment.md → Cloudflare credentials.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'apps', 'web');
export const CREDENTIALS_FILE = '.cloudflare.env';

const ALLOWED_KEYS = new Set(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;
/** Other ways wrangler can authenticate: removed, so only the token below is used. */
const OTHER_AUTH_KEYS = ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_TOKEN', 'CF_API_KEY', 'CF_EMAIL', 'CF_ACCOUNT_ID'];
const HELP = 'See docs/deployment.md → Cloudflare credentials.';

export type Credentials = { accountId: string; apiToken: string };
type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseCredentialsFile(text: string): Result<Credentials> {
  let parsed: Record<string, string>;
  try {
    parsed = parseEnv(text) as Record<string, string>;
  } catch {
    return { ok: false, message: `${CREDENTIALS_FILE} could not be read as KEY=value lines.` };
  }
  const unknown = Object.keys(parsed).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) return { ok: false, message: `${CREDENTIALS_FILE} holds only CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (found ${unknown.join(', ')}).` };
  const accountId = (parsed.CLOUDFLARE_ACCOUNT_ID ?? '').trim().toLowerCase();
  const apiToken = (parsed.CLOUDFLARE_API_TOKEN ?? '').trim();
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, message: `CLOUDFLARE_ACCOUNT_ID in ${CREDENTIALS_FILE} must be the 32-character account id.` };
  if (!apiToken || /\s/.test(apiToken)) return { ok: false, message: `CLOUDFLARE_API_TOKEN in ${CREDENTIALS_FILE} is missing.` };
  return { ok: true, value: { accountId, apiToken } };
}

/** `account_id` in a wrangler.jsonc, or null when it is not set. */
export function configuredAccountId(wranglerJsonc: string): string | null {
  const id = wranglerJsonc.match(/^\s*"account_id"\s*:\s*"([^"]*)"/m)?.[1]?.trim().toLowerCase();
  return id && ACCOUNT_ID_RE.test(id) ? id : null;
}

/**
 * The environment a Cloudflare command runs with: the file wins; without it,
 * the environment's token only under CI. Pure (tested).
 */
export function resolveCredentials(input: {
  fileText: string | null;
  env: Record<string, string | undefined>;
  configAccountId: string | null;
}): Result<Credentials> {
  const { fileText, env, configAccountId } = input;
  if (!configAccountId) return { ok: false, message: `Set "account_id" in apps/web/wrangler.jsonc to this project's Cloudflare account first. ${HELP}` };
  let creds: Credentials;
  if (fileText !== null) {
    const parsed = parseCredentialsFile(fileText);
    if (!parsed.ok) return { ok: false, message: `${parsed.message} ${HELP}` };
    creds = parsed.value;
  } else if (env.CI && env.CLOUDFLARE_API_TOKEN) {
    creds = { accountId: (env.CLOUDFLARE_ACCOUNT_ID || configAccountId).trim().toLowerCase(), apiToken: env.CLOUDFLARE_API_TOKEN.trim() };
  } else {
    return { ok: false, message: `No ${CREDENTIALS_FILE} at the repo root: this project never uses the global \`wrangler login\`. ${HELP}` };
  }
  if (creds.accountId !== configAccountId) {
    return { ok: false, message: `The account id in ${fileText !== null ? CREDENTIALS_FILE : 'CLOUDFLARE_ACCOUNT_ID'} is not the "account_id" in apps/web/wrangler.jsonc. Refusing: that would reach another account.` };
  }
  return { ok: true, value: creds };
}

/** The process environment for a Cloudflare command, or exits with the reason. */
export function cloudflareEnv(): NodeJS.ProcessEnv {
  const file = path.join(ROOT, CREDENTIALS_FILE);
  const result = resolveCredentials({
    fileText: existsSync(file) ? readFileSync(file, 'utf8') : null,
    env: process.env,
    configAccountId: configuredAccountId(readFileSync(path.join(WEB, 'wrangler.jsonc'), 'utf8')),
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: result.value.accountId, CLOUDFLARE_API_TOKEN: result.value.apiToken };
  for (const key of OTHER_AUTH_KEYS) delete env[key];
  return env;
}

export function wranglerBin(): string {
  return path.join(path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
}

function main(argv: string[]): number {
  const [tool, ...rest] = argv;
  const run = (args: string[], cwd: string) => spawnSync(process.execPath, args, { cwd, env: cloudflareEnv(), stdio: 'inherit' }).status ?? 1;
  switch (tool) {
    case 'wrangler':
      return run([wranglerBin(), ...rest], WEB);
    case 'node':
      return run(rest, ROOT);
    case 'npm': {
      const npmCli = process.env.npm_execpath;
      if (npmCli && /\.c?js$/.test(npmCli)) return run([npmCli, ...rest], ROOT);
      return spawnSync('npm', rest, { cwd: ROOT, env: cloudflareEnv(), stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
    }
    default:
      console.error('Usage: tsx scripts/cloudflare.ts <wrangler|npm|node> [args…]   (npm run wrangler -- <args>)');
      return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
