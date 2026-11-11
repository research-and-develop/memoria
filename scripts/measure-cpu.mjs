#!/usr/bin/env node
/**
 * Measure the deployed Worker's CPU time per request.
 *
 *   npm run measure:cpu -- https://memoria.<account>.workers.dev/ [count=20]
 *   npm run measure:cpu -- https://example.com/ 20 --version <version-id>
 *   npm run measure:cpu -- https://example.com/ 20 --group-by x-cache-state
 *
 * Opens `wrangler tail --format json` on the Worker, requests the URL `count`
 * times (sequentially, with a unique `cpu_probe` query to match the tail events),
 * and reports the CPU and wall time of each invocation from the tail events
 * (`cpuTime`, `wallTime`, in ms). The free plan allows 10 ms CPU per request.
 *
 * The numbers are grouped by a response header (`--group-by`, default
 * `cf-cache-status`; "-" when absent) — point it at your own cache header to
 * see hits and renders apart. `--version <id>` sends
 * `Cloudflare-Workers-Version-Overrides`, reaching a version deployed at 0%.
 *
 * Needs `wrangler login` (or CLOUDFLARE_API_TOKEN). Run from the repo root.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** wrangler.jsonc `name` (guard: scripts/guards/wrangler-config.test.ts). */
const WORKER = 'memoria';
const FREE_PLAN_CPU_MS = 10;

const args = process.argv.slice(2);
const versionAt = args.indexOf('--version');
const version = versionAt >= 0 ? args.splice(versionAt, 2)[1] : null;
const groupAt = args.indexOf('--group-by');
const groupBy = groupAt >= 0 ? args.splice(groupAt, 2)[1] : 'cf-cache-status';
const [rawUrl, rawCount] = args;
if (!rawUrl || (versionAt >= 0 && !version)) {
  console.error('usage: npm run measure:cpu -- <url> [count] [--version <version-id>] [--group-by <header>]');
  process.exit(2);
}
const target = new URL(rawUrl);
const count = Math.max(1, Number.parseInt(rawCount ?? '20', 10) || 20);
const runId = Math.random().toString(36).slice(2, 8);

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
const tail = spawn('npx', ['wrangler', 'tail', WORKER, '--format', 'json'], {
  cwd: webDir,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

/**
 * Stop the tail. On Windows `spawn` runs it through a shell, and killing the
 * shell leaves wrangler running — which also keeps this process alive — so
 * kill the whole tree there.
 */
function stopTail() {
  if (tail.exitCode !== null) return;
  if (process.platform === 'win32' && tail.pid) spawnSync('taskkill', ['/pid', String(tail.pid), '/T', '/F'], { stdio: 'ignore' });
  else tail.kill();
}

/** Pull complete top-level JSON objects out of a stream (wrangler pretty-prints them over many lines). */
function createObjectSplitter(onObject) {
  let buffer = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  return (chunk) => {
    for (const ch of chunk) {
      if (depth > 0) buffer += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"' && depth > 0) inString = true;
      else if (ch === '{') {
        if (depth === 0) {
          buffer = '{';
          start = 0;
        }
        depth += 1;
      } else if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start === 0) {
          start = -1;
          try {
            onObject(JSON.parse(buffer));
          } catch {
            // Not an event (a stray brace in a log line) — skip it.
          }
        }
      }
    }
  };
}

const samples = [];
const probe = new RegExp(`cpu_probe=${runId}-(\\d+)(?:&|$)`);
const feed = createObjectSplitter((event) => {
  const url = event?.event?.request?.url;
  const match = typeof url === 'string' ? probe.exec(url) : null;
  if (!match) return;
  samples.push({
    index: Number(match[1]),
    cpu: typeof event.cpuTime === 'number' ? event.cpuTime : null,
    wall: typeof event.wallTime === 'number' ? event.wallTime : null,
    outcome: event.outcome,
  });
});
tail.stdout.setEncoding('utf8');
tail.stdout.on('data', feed);

let connected = false;
tail.stderr.setEncoding('utf8');
tail.stderr.on('data', (text) => {
  if (/connected/i.test(text)) connected = true;
  if (/error/i.test(text)) process.stderr.write(text);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // wrangler 4 prints nothing once connected in `--format json` (the "Connected" line is
  // pretty-format only), so a tail that is still running after a grace period counts as up.
  for (let waited = 0; !connected && waited < 10_000 && tail.exitCode === null; waited += 250) await sleep(250);
  if (tail.exitCode !== null) throw new Error(`wrangler tail exited (${tail.exitCode}) — logged in? Worker deployed?`);
  await sleep(2_000); // the tail session needs a moment before it receives events

  const statuses = [];
  const states = [];
  const headers = { 'cache-control': 'no-cache' };
  if (version) headers['Cloudflare-Workers-Version-Overrides'] = `${WORKER}="${version}"`;
  for (let i = 0; i < count; i += 1) {
    const url = new URL(target);
    url.searchParams.set('cpu_probe', `${runId}-${i}`);
    const res = await fetch(url, { headers });
    statuses.push(res.status);
    states[i] = res.headers.get(groupBy) ?? '-';
    await res.arrayBuffer();
  }

  for (let waited = 0; samples.length < count && waited < 20_000; waited += 500) await sleep(500);
  stopTail();

  const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);
  const sorted = (group, field) => group.map((s) => s[field]).filter((v) => v !== null).sort((a, b) => a - b);

  console.log(`\n${target.href}${version ? ` (version ${version})` : ''} — ${count} requests, HTTP ${[...new Set(statuses)].join('/')}, ${samples.length} tail events`);
  if (!samples.some((s) => s.cpu !== null)) {
    console.log('No cpuTime in the tail events. Read CPU time from Workers Logs (dashboard → Worker → Logs) instead.');
    return;
  }
  for (const state of new Set(states)) {
    const group = samples.filter((s) => states[s.index] === state);
    const cpu = sorted(group, 'cpu');
    const wall = sorted(group, 'wall');
    const outcomes = group.reduce((acc, s) => ({ ...acc, [s.outcome]: (acc[s.outcome] ?? 0) + 1 }), {});
    console.log(`\n${groupBy}: ${state} — ${states.filter((s) => s === state).length} requests, ${group.length} tail events, outcomes ${JSON.stringify(outcomes)}`);
    if (cpu.length) console.log(`  CPU  ms: median ${pct(cpu, 50)} · p95 ${pct(cpu, 95)} · max ${cpu.at(-1)}  (free plan limit ${FREE_PLAN_CPU_MS})`);
    if (wall.length) console.log(`  Wall ms: median ${pct(wall, 50)} · p95 ${pct(wall, 95)} · max ${wall.at(-1)}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    stopTail();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
