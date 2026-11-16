#!/usr/bin/env node
/**
 * `npm run dev:relay`: the relay Worker locally, next to `npm run dev` (plan p03 → Local development).
 *
 * - Runs `wrangler dev` for apps/relay on port 8790 with node directly (not `npx`: on Windows a
 *   stopped `npx` leaves workerd running), persisting to the app's `.wrangler/state`, so both read
 *   the SAME local D1 (same database_id, same directory). Migrate once from the app:
 *   `npm run db:migrate:local`.
 * - POSTs `/run` every 10 s: locally neither the cron nor the app's nudge is guaranteed to arrive.
 *   The cron can be fired by hand: `curl "http://127.0.0.1:8790/cdn-cgi/local/scheduled?time=<epoch ms>"`.
 * - On exit (Ctrl+C) it kills wrangler's whole process tree.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8790;
const NUDGE_EVERY_MS = 10_000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const args = [
  wrangler,
  'dev',
  '-c',
  path.join(root, 'apps/relay/wrangler.jsonc'),
  '--port',
  String(PORT),
  '--persist-to',
  path.join(root, 'apps/web/.wrangler/state'),
  ...process.argv.slice(2),
];

const child = spawn(process.execPath, args, { cwd: path.join(root, 'apps/relay'), stdio: 'inherit' });

let ready = false;
const timer = setInterval(async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/run`, { method: 'POST' });
    if (!ready && res.status === 202) {
      ready = true;
      console.log(`[relay-dev] the relay answers on ${PORT}; nudging every ${NUDGE_EVERY_MS / 1000} s`);
    }
  } catch {
    // Still starting, or restarting after a change.
  }
}, NUDGE_EVERY_MS);

function stop(code = 0) {
  clearInterval(timer);
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});
