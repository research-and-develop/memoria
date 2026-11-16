import type { Mailer } from '../ports';

import { parseEmailAddress } from './address';
import { MailError } from './error';
import { jsonBody, mailFetch, retryAfterSeconds, stringField, type FetchLike } from './http';
import { maskAddresses } from './mask';
import { base64, buildMessage, checkMessage } from './mime';

/**
 * Microsoft 365 through Microsoft Graph (plan p03 → HTTPS adapters): an app-only token (client
 * credentials), then `POST /users/<mailbox>/sendMail` with the base64 MIME (`text/plain`). Graph
 * answers 202 with no id; our Message-ID (the job id) is the reference. A copy lands in the
 * mailbox's Sent Items.
 *
 * The token is cached per isolate on `globalThis`, keyed by sha256(tenant|client id|secret) (a new
 * secret fetches a new token), as the in-flight promise (concurrent sends share one request; a
 * failed request is dropped), until 5 minutes before it expires. A 401 on send refreshes it once.
 *
 * | Answer | Outcome |
 * | --- | --- |
 * | token 4xx (`invalid_client`, `invalid_scope`, unknown tenant) | configuration `GRAPH_TOKEN_<status>` |
 * | send 202 | sent |
 * | send 401 after one refresh, 403 (`ErrorAccessDenied`) | configuration |
 * | send 400, 404, 413, other 4xx | permanent |
 * | 409, 423 (mailbox busy), 429, 5xx, network, timeout | transient (`Retry-After` honoured) |
 *
 * The tenant goes into a URL: a GUID or a domain only; the mailbox must be an address we accept.
 */
export type Microsoft365Settings = { tenantId: string; clientId: string; clientSecret: string; mailbox: string };

const TOKEN_SCOPE = 'https://graph.microsoft.com/.default';
const REFRESH_BEFORE_MS = 5 * 60_000;
const TENANT_GUID_RE = /^[0-9a-f-]{36}$/i;
const TENANT_DOMAIN_RE = /^[A-Za-z0-9.-]{1,253}$/;

export const tokenUrl = (tenantId: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
export const sendMailUrl = (mailbox: string) => `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;

export function isTenantId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (TENANT_GUID_RE.test(value)) return true;
  return TENANT_DOMAIN_RE.test(value) && value.includes('.') && !value.startsWith('.') && !value.endsWith('.') && !value.includes('..');
}

type Token = { accessToken: string; expiresAt: number };
const CACHE_KEY = Symbol.for('memoria.mail.microsoft365.tokens');
type Holder = { [CACHE_KEY]?: Map<string, Promise<Token>> };

function tokenCache(): Map<string, Promise<Token>> {
  const holder = globalThis as Holder;
  holder[CACHE_KEY] ??= new Map();
  return holder[CACHE_KEY];
}

/** Test-only: forget every cached token. */
export function resetMicrosoftTokenCache(): void {
  tokenCache().clear();
}

async function cacheKey(settings: Microsoft365Settings): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${settings.tenantId}|${settings.clientId}|${settings.clientSecret}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rejects with MAIL_ABORTED as soon as `signal` aborts, whatever `promise` does. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new MailError('MAIL_ABORTED'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MailError('MAIL_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function microsoft365Mailer(settings: Microsoft365Settings, fetchFn: FetchLike, opts: { now?: () => Date } = {}): Mailer {
  const now = opts.now ?? (() => new Date());
  const secrets = [settings.clientSecret, settings.clientId, settings.tenantId];

  async function requestToken(): Promise<Token> {
    const requestedAt = now().getTime();
    const form = new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, scope: TOKEN_SCOPE, grant_type: 'client_credentials' });
    // Not the caller's signal: other sends may share this request. The timeout still applies.
    const response = await mailFetch(
      fetchFn,
      tokenUrl(settings.tenantId),
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString() },
      { signal: new AbortController().signal, prefix: 'GRAPH_TOKEN' },
    );
    const json = await jsonBody(response);
    const accessToken = stringField(json, 'access_token');
    if (response.ok && accessToken) {
      const expiresIn = typeof json === 'object' && json !== null ? Number((json as Record<string, unknown>).expires_in) : NaN;
      return { accessToken, expiresAt: requestedAt + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000 };
    }
    const text = [stringField(json, 'error'), stringField(json, 'error_description')].filter(Boolean).join(': ');
    const detail = text ? maskAddresses(text, { also: secrets }) : undefined;
    const code = `GRAPH_TOKEN_${response.status}`;
    if (response.status === 429 || response.status >= 500) throw new MailError(code, { retryAfterSeconds: retryAfterSeconds(response), detail });
    // 4xx (a wrong secret, client id, scope or tenant), or a 2xx without a token: configuration.
    throw new MailError(code, { configuration: true, detail });
  }

  async function token(signal: AbortSignal, refresh: string | null): Promise<string> {
    const key = await cacheKey(settings);
    const cache = tokenCache();
    let entry = cache.get(key);
    if (entry) {
      const cached = await untilAborted(
        entry.catch(() => null),
        signal,
      );
      const stale = !cached || cached.accessToken === refresh || cached.expiresAt - REFRESH_BEFORE_MS <= now().getTime();
      if (!stale) return cached.accessToken;
      if (cache.get(key) === entry) cache.delete(key);
      entry = cache.get(key); // another send may have refreshed it meanwhile
    }
    if (!entry) {
      const fresh = requestToken();
      entry = fresh;
      cache.set(key, fresh);
      fresh.catch(() => {
        if (cache.get(key) === fresh) cache.delete(key);
      });
    }
    return (await untilAborted(entry, signal)).accessToken;
  }

  return {
    async send(message, { signal }) {
      const { to } = checkMessage(message);
      if (!isTenantId(settings.tenantId)) throw new MailError('MAIL_INVALID_SETTINGS', { permanent: true, configuration: true, detail: 'tenantId' });
      const mailbox = parseEmailAddress(settings.mailbox);
      if (!mailbox) throw new MailError('MAIL_INVALID_SETTINGS', { permanent: true, configuration: true, detail: 'mailbox' });
      if (signal.aborted) throw new MailError('MAIL_ABORTED');
      const body = base64(new TextEncoder().encode(buildMessage(message, { date: now() })));

      let used: string | null = null;
      for (let round = 0; round < 2; round++) {
        used = await token(signal, used);
        const response = await mailFetch(
          fetchFn,
          sendMailUrl(mailbox),
          { method: 'POST', headers: { authorization: `Bearer ${used}`, 'content-type': 'text/plain' }, body },
          { signal, prefix: 'GRAPH' },
        );
        if (response.status === 202 || response.ok) return { providerMessageId: null };
        if (response.status === 401 && round === 0) continue; // the token was revoked or expired early: refresh once

        const json = await jsonBody(response);
        const error = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).error : undefined;
        const text = [stringField(error, 'code'), stringField(error, 'message')].filter(Boolean).join(': ');
        const detail = text ? maskAddresses(text, { also: [to, mailbox, ...secrets, used] }) : undefined;
        const code = `GRAPH_${response.status}`;
        const status = response.status;
        if (status === 401 || status === 403) throw new MailError(code, { configuration: true, detail });
        if (status === 409 || status === 423 || status === 429 || status >= 500) throw new MailError(code, { retryAfterSeconds: retryAfterSeconds(response), detail });
        if (status >= 400) throw new MailError(code, { permanent: true, detail });
        throw new MailError(code, { detail });
      }
      throw new MailError('GRAPH_401', { configuration: true });
    },
  };
}
