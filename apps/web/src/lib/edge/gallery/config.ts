import { deriveGalleryKeys, type GalleryKeys } from './access';
import type { EdgeGalleryConfig } from './deps';

/**
 * The gallery handler's config (plan p06 D6.9), from what the host has:
 * - `edgeGalleryConfig(env)`: `worker.ts`, from the env's strings (parsed here, not by `parseConfig`,
 *   which `edge-graph` would have to accept). `APP_NAME` is read raw as the studio name's fallback —
 *   not through `Config.bootstrap`, so guard `settings-through-store` is not involved (D6.8);
 * - `galleryConfig(parts)`: the development route handlers, from `getPlatform().config()`.
 * The derived keys are kept on `globalThis` per secret fingerprint: derived once per isolate.
 */
export type EdgeGalleryEnv = {
  MEDIA_PUBLIC_BASE_URL?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  APP_NAME?: string;
  NEXTJS_ENV?: string;
};

export const DEFAULT_APP_NAME = 'Memoria';
const SECRET_BYTES = 32;

/** Exactly 32 bytes of base64, decoded as `parseConfig` does (`SETTINGS_ENCRYPTION_KEY`), else null. */
export function decodeSecret(value: string | undefined): Uint8Array | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  try {
    const binary = atob(text);
    return binary.length === SECRET_BYTES ? Uint8Array.from(binary, (ch) => ch.charCodeAt(0)) : null;
  } catch {
    return null;
  }
}

const KEYS = Symbol.for('memoria.edge.galleryKeys');
type KeyCache = Map<string, Promise<GalleryKeys>>;

async function fingerprint(secret: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(secret)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The derived keys of a secret, once per isolate (a process-wide singleton lives on `globalThis`). */
export async function galleryKeysFor(secret: Uint8Array | null): Promise<GalleryKeys | null> {
  if (!secret) return null;
  const holder = globalThis as unknown as Record<symbol, KeyCache | undefined>;
  const cache = (holder[KEYS] ??= new Map());
  const id = await fingerprint(secret);
  let keys = cache.get(id);
  if (!keys) {
    keys = deriveGalleryKeys(secret);
    cache.set(id, keys);
  }
  return keys;
}

export async function galleryConfig(parts: {
  mediaBaseUrl: string | null;
  secret: Uint8Array | null;
  turnstileSiteKey: string;
  appName: string;
  isDevelopment: boolean;
}): Promise<EdgeGalleryConfig> {
  return {
    mediaBaseUrl: parts.mediaBaseUrl?.trim().replace(/\/+$/, '') || null,
    keys: await galleryKeysFor(parts.secret),
    turnstileSiteKey: parts.turnstileSiteKey,
    appName: parts.appName.trim() || DEFAULT_APP_NAME,
    isDevelopment: parts.isDevelopment,
  };
}

export function edgeGalleryConfig(env: EdgeGalleryEnv): Promise<EdgeGalleryConfig> {
  return galleryConfig({
    mediaBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? null,
    secret: decodeSecret(env.SETTINGS_ENCRYPTION_KEY),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() ?? '',
    appName: env.APP_NAME ?? '',
    isDevelopment: env.NEXTJS_ENV === 'development',
  });
}
