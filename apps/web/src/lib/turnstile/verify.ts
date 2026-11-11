import 'server-only';

import { logger } from '@repo/logger';

/**
 * Server-side Turnstile check — the widget alone protects
 * nothing. Calls siteverify, then checks the token was issued for THIS form
 * (`action`) and, when the site's host is known, for this hostname.
 * Cloudflare's test secrets (local dev, tests) answer with a dummy hostname
 * and no action, so those two checks are skipped for them.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TEST_SECRETS = new Set(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing_token' | 'not_configured' | 'rejected' | 'wrong_action' | 'wrong_hostname' | 'unavailable' };

type SiteverifyResponse = { success: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };

export async function verifyTurnstile(input: {
  token: unknown;
  secret: string | undefined;
  action: 'contact' | 'login';
  remoteIp?: string;
  /** The hostname the widget must have run on (from the request); null skips the check. */
  hostname?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileResult> {
  if (typeof input.token !== 'string' || input.token.length === 0 || input.token.length > 2048) return { ok: false, reason: 'missing_token' };
  if (!input.secret) return { ok: false, reason: 'not_configured' };
  const body = new FormData();
  body.set('secret', input.secret);
  body.set('response', input.token);
  if (input.remoteIp) body.set('remoteip', input.remoteIp);
  let data: SiteverifyResponse;
  try {
    const res = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, { method: 'POST', body });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    data = (await res.json()) as SiteverifyResponse;
  } catch (error) {
    logger.warn({ event: 'turnstile_unavailable', message: (error as Error).message });
    return { ok: false, reason: 'unavailable' };
  }
  if (!data.success) {
    logger.info({ event: 'turnstile_rejected', action: input.action, codes: data['error-codes'] ?? [] });
    return { ok: false, reason: 'rejected' };
  }
  if (TEST_SECRETS.has(input.secret)) return { ok: true };
  if (data.action !== input.action) return { ok: false, reason: 'wrong_action' };
  if (input.hostname && data.hostname && data.hostname !== input.hostname) return { ok: false, reason: 'wrong_hostname' };
  return { ok: true };
}
