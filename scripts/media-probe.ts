/**
 * Round-trips a file through the development blob routes of a running app (Phase 1, V4).
 *
 *   npm run preview                                   (or npm run dev, port 3210)
 *   npm run media:probe -- http://localhost:8787
 *
 * Reads `apps/web/.dev.vars` for MEDIA_DEV_SIGNING_SECRET, mints an upload and a read URL with
 * `blobUrls` in dev mode (as server code would), PUTs a built-in 1×1 PNG to `dev/probe-<uuid>.png`
 * with an `Origin` header, GETs it back, compares the bytes, prints the response headers the
 * browser would see and PASS or FAIL (exit code 1). The object stays in the LOCAL bucket.
 * Needs no Cloudflare account; refuses to run without the dev secret.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blobUrls } from '@repo/platform/blobUrls';
import { parseConfig } from '@repo/platform/config';

const DEV_VARS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', '.dev.vars');
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** `KEY=value` lines of a .dev.vars file; `#` comments and blank lines skipped, values trimmed. */
export function parseDevVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) vars[m[1]!] = m[2]!.trim();
  }
  return vars;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const base = process.argv[2]?.replace(/\/+$/, '');
  if (!base || !/^https?:\/\//.test(base)) fail('usage: npm run media:probe -- <base-url>, e.g. http://localhost:8787');

  let text: string;
  try {
    text = readFileSync(DEV_VARS, 'utf8');
  } catch {
    fail(`cannot read ${DEV_VARS}: copy apps/web/.dev.vars.example to apps/web/.dev.vars`);
  }
  const config = parseConfig({ ...parseDevVars(text), NEXTJS_ENV: 'development' });
  if (!config.media.devSigningSecret) fail('MEDIA_DEV_SIGNING_SECRET (≥ 32 characters) is missing from apps/web/.dev.vars; copy it from .dev.vars.example');
  // Dev mode only, whatever S3 settings the file holds.
  const urls = blobUrls({ ...config, media: { ...config.media, s3: null } });

  const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0));
  const key = `dev/probe-${crypto.randomUUID()}.png`;
  const upload = await urls.uploadUrl(key, { contentType: 'image/png', size: png.byteLength });
  const put = await fetch(`${base}${upload.url}`, { method: 'PUT', headers: { ...upload.headers, origin: base }, body: png });
  console.log(`PUT ${key} → ${put.status} ${await put.text()}`);
  if (!put.ok) fail('the upload was refused');

  const get = await fetch(`${base}${await urls.readUrl(key, { downloadName: 'probe.png' })}`);
  const back = new Uint8Array(await get.arrayBuffer());
  console.log(`GET → ${get.status}`);
  get.headers.forEach((value, name) => console.log(`  ${name}: ${value}`));
  if (!get.ok) fail('the read was refused');
  if (back.byteLength !== png.byteLength || back.some((b, i) => b !== png[i])) fail('the bytes read back differ from the bytes sent');
  console.log(`PASS: ${png.byteLength} bytes round-tripped through ${base}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
