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
 * 5. The relay Worker (apps/relay, plan p03): rules 1–2 for its own config and
 *    `relay-env.d.ts`; no public URL; one cron; its `alias` = its tsconfig
 *    `paths`; its composition root exports what Next's does. And the two
 *    Workers agree: the app's RELAY service names the relay; same account,
 *    compatibility, D1, bucket and shared vars; only the app migrates.
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
  account_id?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  workers_dev?: boolean;
  preview_urls?: boolean;
  route?: unknown;
  routes?: unknown[];
  triggers?: { crons?: string[] };
  alias?: Record<string, string>;
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
export function generatedEnv(dts: string, name = 'CloudflareEnv'): Map<string, string> {
  const body = new RegExp(`interface (?:__BaseEnv_)?${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(dts)?.[1];
  if (body === undefined) throw new Error(`no ${name} interface in the generated env (re-run npm run cf-typegen)`);
  return new Map([...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:\s*(.+?);\s*$/gm)].map(([, key = '', type = '']) => [key, type]));
}

export function secretLookingVars(vars: Record<string, string>): string[] {
  return Object.keys(vars).filter((name) => SECRET_NAME_RE.test(name) && !(name in PUBLIC_VARS));
}

/** Names a module exports (`export function x`, `export const x`, `export { a, b as c } from …`). */
export function exportedNames(source: string): string[] {
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] ?? '');
  for (const m of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names.sort();
}

/** What a config, its `.dev.vars.example` and its generated env disagree on. */
function envDrift(config: WranglerConfig, devVars: string[], generated: Map<string, string>) {
  const expected = new Set([...bindingNames(config), ...Object.keys(config.vars ?? {}), ...devVars]);
  return {
    missing: [...expected].filter((k) => !generated.has(k)).sort(),
    stale: [...generated.keys()].filter((k) => !expected.has(k)).sort(),
    changed: Object.entries(config.vars ?? {})
      .filter(([k, v]) => {
        const type = generated.get(k) ?? '';
        return type.startsWith('"') && type !== JSON.stringify(v);
      })
      .map(([k]) => k),
  };
}

const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const config = parseJsonc('wrangler.jsonc', readFileSync(path.join(APP, 'wrangler.jsonc'), 'utf8')) as WranglerConfig;
const devVars = devVarsKeys(readFileSync(path.join(APP, '.dev.vars.example'), 'utf8'));
const generated = generatedEnv(readFileSync(path.join(APP, 'cloudflare-env.d.ts'), 'utf8'));
const relay = parseJsonc('apps/relay/wrangler.jsonc', read('apps/relay/wrangler.jsonc')) as WranglerConfig;
const relayDevVars = devVarsKeys(read('apps/relay/.dev.vars.example'));
const relayGenerated = generatedEnv(read('apps/relay/relay-env.d.ts'), 'RelayEnv');
const relayTsconfig = parseJsonc('apps/relay/tsconfig.json', read('apps/relay/tsconfig.json')) as { compilerOptions?: { paths?: Record<string, string[]> } };

describe('wrangler.jsonc', () => {
  it('parses, names the Worker and enables nodejs_compat', () => {
    expect(config.name).toBeTruthy();
    expect(config.compatibility_flags).toContain('nodejs_compat');
  });

  it('cloudflare-env.d.ts matches it (else run `npm run cf-typegen`)', () => {
    expect(generated.size).toBeGreaterThan(3);
    const drift = envDrift(config, devVars, generated);
    expect(drift.missing, 'missing from cloudflare-env.d.ts').toEqual([]);
    expect(drift.stale, 'stale in cloudflare-env.d.ts').toEqual([]);
    expect(drift.changed, 'a var changed value since the last cf-typegen').toEqual([]);
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

describe("the relay's wrangler.jsonc (apps/relay)", () => {
  it('relay-env.d.ts matches it (else run `npm run cf-typegen`)', () => {
    expect(relayGenerated.size).toBeGreaterThan(3);
    const drift = envDrift(relay, relayDevVars, relayGenerated);
    expect(drift.missing, 'missing from relay-env.d.ts').toEqual([]);
    expect(drift.stale, 'stale in relay-env.d.ts').toEqual([]);
    expect(drift.changed, 'a var changed value since the last cf-typegen').toEqual([]);
  });

  it('keeps secrets and NEXTJS_ENV out of `vars`', () => {
    expect(secretLookingVars(relay.vars ?? {})).toEqual([]);
    expect(Object.keys(relay.vars ?? {})).not.toContain('NEXTJS_ENV');
  });

  it('has no public URL and exactly one cron (D3.13)', () => {
    expect(relay.workers_dev, 'workers_dev').toBe(false);
    expect(relay.preview_urls, 'preview_urls').toBe(false);
    expect(relay.route ?? relay.routes, 'route(s)').toBeUndefined();
    expect(relay.triggers?.crons ?? []).toHaveLength(1);
  });

  it('its alias and its tsconfig paths map the composition root and server-only to the same files', () => {
    const dir = path.join(ROOT, 'apps/relay');
    for (const key of ['@repo/platform/current', 'server-only']) {
      const alias = relay.alias?.[key];
      const target = relayTsconfig.compilerOptions?.paths?.[key]?.[0];
      expect(alias, `alias ${key}`).toBeTruthy();
      expect(path.resolve(dir, alias ?? ''), key).toBe(path.resolve(dir, target ?? ''));
    }
    expect(path.resolve(dir, relay.alias?.['@repo/platform/current'] ?? '')).toBe(path.join(ROOT, 'packages/platform-cloudflare/relay.ts'));
  });

  it("its composition root exports every name Next's does", () => {
    const next = exportedNames(read('packages/platform/current.ts'));
    expect(next).toContain('getPlatform');
    const own = exportedNames(read('packages/platform-cloudflare/relay.ts'));
    expect(next.filter((n) => !own.includes(n))).toEqual([]);
  });
});

describe('the app and the relay agree', () => {
  it("the app's RELAY service names the relay", () => {
    expect((config.services ?? []).filter((s) => s.binding === 'RELAY').map((s) => s.service)).toEqual([relay.name]);
  });

  it('same account, compatibility date and flags', () => {
    expect(config.account_id, 'the app pins its account').toMatch(/^[0-9a-f]{32}$/);
    expect(relay.account_id).toBe(config.account_id);
    expect(relay.compatibility_date).toBe(config.compatibility_date);
    expect([...(relay.compatibility_flags ?? [])].sort()).toEqual([...(config.compatibility_flags ?? [])].sort());
  });

  it('the same D1 and bucket; only the app migrates', () => {
    type D1 = Binding & { database_name?: string; database_id?: string; preview_database_id?: string; migrations_dir?: string };
    const appDb = (config.d1_databases ?? []).find((b) => b.binding === 'DB') as D1 | undefined;
    const relayDb = (relay.d1_databases ?? []).find((b) => b.binding === 'DB') as D1 | undefined;
    expect(appDb?.migrations_dir, 'the app migrates').toBeTruthy();
    expect(relayDb?.migrations_dir, 'the relay never migrates').toBeUndefined();
    // preview_database_id keys the LOCAL database: equal, or `npm run dev:relay` reads another one.
    expect([relayDb?.database_name, relayDb?.database_id, relayDb?.preview_database_id]).toEqual([appDb?.database_name, appDb?.database_id, appDb?.preview_database_id]);
    const bucket = (c: WranglerConfig) => ((c.r2_buckets ?? []).find((b) => b.binding === 'MEDIA') as { bucket_name?: string } | undefined)?.bucket_name;
    expect(bucket(relay)).toBe(bucket(config));
  });

  it("the relay's vars equal the app's", () => {
    const shared = Object.entries(relay.vars ?? {});
    expect(shared.map(([k]) => k).sort()).toEqual(['APP_NAME', 'LOG_FORMAT', 'LOG_LEVEL', 'SITE_URL']);
    for (const [key, value] of shared) expect(value, key).toBe(config.vars?.[key]);
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

  it('reads exported names', () => {
    const src = "export { getPlatform } from './x';\nexport function withPlatform() {}\nexport type { A, B as C } from './y';\nexport const K = 1;";
    expect(exportedNames(src)).toEqual(['A', 'C', 'K', 'getPlatform', 'withPlatform']);
  });

  it('reads an interface by name', () => {
    const dts = 'interface __BaseEnv_RelayEnv {\n\tDB: D1Database;\n}\n';
    expect([...generatedEnv(dts, 'RelayEnv').keys()]).toEqual(['DB']);
    expect(() => generatedEnv(dts)).toThrow();
  });

  it('reads the generated interface (both wrangler spellings)', () => {
    for (const head of ['interface __BaseEnv_CloudflareEnv {', 'interface CloudflareEnv {']) {
      const env = generatedEnv(`${head}\n\tDB: D1Database;\n\tAPP_NAME: "X";\n\tOPT?: string;\n}\n`);
      expect([...env]).toEqual([['DB', 'D1Database'], ['APP_NAME', '"X"'], ['OPT', 'string']]);
    }
  });
});
