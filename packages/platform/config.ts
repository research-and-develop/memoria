import type { Config } from './ports';

/**
 * The runtime configuration from plain string env: Cloudflare's `env` (vars and secrets, through
 * `stringEnv`) or Node's `process.env`. Pure and total: it never throws; a missing or empty value
 * closes its feature (an empty ADMIN_EMAIL closes the admin login) or becomes `null`.
 *
 * A new setting = a field on `Config` (ports.ts), a line here, a row in config.test.ts, and the var
 * in wrangler.jsonc or the secret in .dev.vars.example (AGENTS.md → Cloudflare rules).
 */
export type StringEnv = Readonly<Record<string, string | undefined>>;

/** Shorter secrets are treated as unset: too weak to sign anything. */
export const MIN_SIGNING_SECRET_LENGTH = 32;

const text = (env: StringEnv, name: string): string => env[name]?.trim() ?? '';
const optional = (env: StringEnv, name: string): string | null => text(env, name) || null;
const origin = (env: StringEnv, name: string): string | null => optional(env, name)?.replace(/\/+$/, '') || null;

export function parseConfig(env: StringEnv): Config {
  const devSigningSecret = text(env, 'MEDIA_DEV_SIGNING_SECRET');
  const s3 = {
    endpoint: origin(env, 'MEDIA_S3_ENDPOINT'),
    bucket: optional(env, 'MEDIA_S3_BUCKET'),
    accessKeyId: optional(env, 'MEDIA_S3_ACCESS_KEY_ID'),
    secretAccessKey: optional(env, 'MEDIA_S3_SECRET_ACCESS_KEY'),
  };
  return {
    appName: text(env, 'APP_NAME') || 'Memoria',
    siteUrl: origin(env, 'SITE_URL'),
    isDevelopment: text(env, 'NEXTJS_ENV') === 'development',
    admin: { email: text(env, 'ADMIN_EMAIL').toLowerCase(), passwordHash: text(env, 'ADMIN_PASSWORD_HASH') },
    turnstile: { siteKey: text(env, 'TURNSTILE_SITE_KEY'), secretKey: text(env, 'TURNSTILE_SECRET_KEY') },
    hashSalt: text(env, 'HASH_SALT'),
    media: {
      devSigningSecret: devSigningSecret.length >= MIN_SIGNING_SECRET_LENGTH ? devSigningSecret : null,
      publicBaseUrl: origin(env, 'MEDIA_PUBLIC_BASE_URL'),
      s3:
        s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey
          ? { endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
          : null,
    },
  };
}
