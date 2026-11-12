/**
 * Guard: wrangler.jsonc, the generated env type and the code that names the
 * Worker agree.
 *
 * 1. `cloudflare-env.d.ts` is fresh. Forgetting `npm run cf-typegen` after a
 *    binding, var or secret changes leaves `getCloudflareContext().env` typed
 *    against the OLD config: tsc stays green for a binding that no longer exists,
 *    and a new one is `any`-free but missing. Every binding, var and
 *    `.dev.vars.example` key must be in the generated interface, nothing else
 *    may be, and a var's literal type must still equal its value.
 * 2. No secret in `vars`: they are committed in plain text. Secrets go in
 *    `.dev.vars` / `wrangler secret put`.
 * 3. Two media/env rules: `MEDIA_S3_BUCKET` (the bucket presigned URLs name)
 *    is the bucket the `MEDIA` binding uses, and `NEXTJS_ENV` is never a var:
 *    it switches on the development-only blob routes, so it lives only in
 *    `.dev.vars`, never in config that is deployed.
 * 4. The Worker's name is written in places wrangler cannot see (the
 *    self-reference service, the CPU script). A rename that misses one breaks
 *    them silently. Add any new place (e.g. a version-override header) here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '@repo/core/testing/sourceIndex';

const ROOT = repoRoot();
const APP = path.join(ROOT, 'apps/web');

type Binding = { binding?: string; name?: string; service?: string };
type WranglerConfig = {
  name?: string;
  compatibility_flags?: string[];
  vars?: Record<string, string>;
  assets?: Binding;
  version_metadata?: Binding;
  services?: Binding[];
  d1_databases?: Binding[];
  r2_buckets?: Binding[];
  kv_namespaces?: Binding[];
  send_email?: Binding[];
  queues?: { producers?: Binding[] };
  durable_objects?: { bindings?: Binding[] };
  ai?: Binding;
  images?: Binding;
  browser?: Binding;
  hyperdrive?: Binding[];
  vectorize?: Binding[];
  analytics_engine_datasets?: Binding[];
};

/** Var names that look secret but are public by design, with the reason. */
const PUBLIC_VARS: Record<string, string> = {
  // e.g. Cloudflare Web Analytics: the beacon token is in every public page.
  CF_BEACON_TOKEN: 'the Web Analytics beacon token is in every public page',
};
const SECRET_NAME_RE = /(SECRET|PASSWORD|PRIVATE|API_KEY|ACCESS_KEY|(^|_)SALT$|(^|_)TOKEN$|(^|_)HASH$)/;

export function parseJsonc(fileName: string, text: string): unknown {
  const { config, error } = ts.parseConfigFileTextToJson(fileName, text);
  if (error) throw new Error(`${fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  return config;
}

/** Every env key a binding adds (the names `wrangler types` emits). */
export function bindingNames(config: WranglerConfig): string[] {
  const single = [config.assets, config.version_metadata, config.ai, config.images, config.browser];
  const lists = [
    config.services,
    config.d1_databases,
    config.r2_buckets,
    config.kv_namespaces,
    config.queues?.producers,
    config.hyperdrive,
    config.vectorize,
    config.analytics_engine_datasets,
  ];
  const names = [...single, ...lists.flatMap((l) => l ?? [])].map((b) => b?.binding).filter((n): n is string => !!n);
  // These two are named by `name`, not `binding`.
  for (const b of [...(config.send_email ?? []), ...(config.durable_objects?.bindings ?? [])]) if (b.name) names.push(b.name);
  return names;
}

/** `KEY=value` lines of a .dev.vars file (comments and blanks skipped). */
export function devVarsKeys(text: string): string[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, key = '']) => key);
}

/** The keys of the generated env interface, with their type text. */
export function generatedEnv(dts: string): Map<string, string> {
  const body = /interface (?:__BaseEnv_)?CloudflareEnv\s*\{([\s\S]*?)\n\}/.exec(dts)?.[1];
  if (body === undefined) throw new Error('cloudflare-env.d.ts: no CloudflareEnv interface (re-run npm run cf-typegen)');
  return new Map([...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:\s*(.+?);\s*$/gm)].map(([, key = '', type = '']) => [key, type]));
}

export function secretLookingVars(vars: Record<string, string>): string[] {
  return Object.keys(vars).filter((name) => SECRET_NAME_RE.test(name) && !(name in PUBLIC_VARS));
}

const config = parseJsonc('wrangler.jsonc', readFileSync(path.join(APP, 'wrangler.jsonc'), 'utf8')) as WranglerConfig;
const devVars = devVarsKeys(readFileSync(path.join(APP, '.dev.vars.example'), 'utf8'));
const generated = generatedEnv(readFileSync(path.join(APP, 'cloudflare-env.d.ts'), 'utf8'));

describe('wrangler.jsonc', () => {
  it('parses, names the Worker and enables nodejs_compat', () => {
    expect(config.name).toBeTruthy();
    expect(config.compatibility_flags).toContain('nodejs_compat');
  });

  it('cloudflare-env.d.ts matches it (else run `npm run cf-typegen`)', () => {
    const expected = new Set([...bindingNames(config), ...Object.keys(config.vars ?? {}), ...devVars]);
    expect(expected.size).toBeGreaterThan(3);
    expect([...expected].filter((k) => !generated.has(k)).sort(), 'missing from cloudflare-env.d.ts').toEqual([]);
    expect([...generated.keys()].filter((k) => !expected.has(k)).sort(), 'stale in cloudflare-env.d.ts').toEqual([]);
    const changedValues = Object.entries(config.vars ?? {}).filter(([k, v]) => {
      const type = generated.get(k) ?? '';
      return type.startsWith('"') && type !== JSON.stringify(v);
    });
    expect(changedValues.map(([k]) => k), 'a var changed value since the last cf-typegen').toEqual([]);
  });

  it('keeps secrets out of `vars`', () => {
    expect(
      secretLookingVars(config.vars ?? {}),
      'A var name looks like a secret. Secrets go in .dev.vars(.example) and `wrangler secret put`; a public value goes in PUBLIC_VARS with its reason.',
    ).toEqual([]);
  });

  it('presigned URLs name the bucket the MEDIA binding uses', () => {
    const media = (config.r2_buckets ?? []).find((b) => b.binding === 'MEDIA') as (Binding & { bucket_name?: string }) | undefined;
    expect(media?.bucket_name, 'r2_buckets MEDIA').toBeTruthy();
    expect(config.vars?.MEDIA_S3_BUCKET, 'vars.MEDIA_S3_BUCKET').toBe(media?.bucket_name);
  });

  it('never deploys NEXTJS_ENV (it opens the development-only routes)', () => {
    expect(Object.keys(config.vars ?? {})).not.toContain('NEXTJS_ENV');
  });

  it('every place that names the Worker uses its name', () => {
    const self = (config.services ?? []).filter((s) => s.binding === 'WORKER_SELF_REFERENCE');
    expect(self.map((s) => s.service)).toEqual([config.name]);
    const measure = /const WORKER = '([^']+)'/.exec(readFileSync(path.join(ROOT, 'scripts/measure-cpu.mjs'), 'utf8'))?.[1];
    expect(measure, 'scripts/measure-cpu.mjs WORKER').toBe(config.name);
  });
});

describe('the helpers catch the mistakes they are for', () => {
  it('reads JSONC with comments, URLs in strings and trailing commas', () => {
    expect(parseJsonc('x.jsonc', '{ // c\n "a": "https://x.y/z", /* b */ "b": [1,], }')).toEqual({ a: 'https://x.y/z', b: [1] });
  });

  it.each([
    ['TURNSTILE_SECRET_KEY', true],
    ['ADMIN_PASSWORD_HASH', true],
    ['HASH_SALT', true],
    ['PAGE_CACHE_REFRESH_TOKEN', true],
    ['STRIPE_API_KEY', true],
    ['MEDIA_S3_ACCESS_KEY_ID', true],
    ['MEDIA_S3_SECRET_ACCESS_KEY', true],
    ['MEDIA_S3_BUCKET', false],
    ['TURNSTILE_SITE_KEY', false],
    ['CF_BEACON_TOKEN', false],
    ['SITE_URL', false],
  ])('%s looks secret: %s', (name, secret) => {
    expect(secretLookingVars({ [name]: 'x' })).toEqual(secret ? [name] : []);
  });

  it('reads the generated interface (both wrangler spellings)', () => {
    for (const head of ['interface __BaseEnv_CloudflareEnv {', 'interface CloudflareEnv {']) {
      const env = generatedEnv(`${head}\n\tDB: D1Database;\n\tAPP_NAME: "X";\n\tOPT?: string;\n}\n`);
      expect([...env]).toEqual([['DB', 'D1Database'], ['APP_NAME', '"X"'], ['OPT', 'string']]);
    }
  });
});
