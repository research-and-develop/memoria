/**
 * The studio's mail settings as stored (plan p03, D3.17): the `site_settings` row `mail`. Pure and
 * free of server code, so the Settings → Emails form (Phase 3 commit 4) can share the field rules.
 *
 * Only the chosen provider's block is kept. Its secret is sealed (`v1:…`, lib/settings/secrets.ts);
 * the rest is plain. Every value that reaches a URL, a socket or a header is checked here: the
 * SMTP host (a DNS name, never an IP or a local name) and port (465, 587, 2525), the SES region (a
 * fixed list), the Microsoft tenant (an id or a domain), every address, the From name.
 */
import { parseEmailAddress } from '@repo/platform/mail/address';
import { isTenantId } from '@repo/platform/mail/microsoft365';
import { isHeaderSafe } from '@repo/platform/mail/mime';
import { isSesRegion, type SesRegion } from '@repo/platform/mail/sesRegions';
import { isSmtpHost, SMTP_PORTS, type SmtpPort } from '@repo/platform/mail/smtpHost';
import type { MailProvider } from '@repo/platform/mail/transport';

import { isSealed } from './secrets';

export type { MailProvider };
export const MAIL_PROVIDERS: readonly MailProvider[] = ['smtp', 'brevo', 'ses', 'microsoft365'];

/** The one secret field of each provider (its AAD is `mail.<provider>.<field>`). */
export const MAIL_SECRET_FIELD = { smtp: 'password', brevo: 'apiKey', ses: 'secretAccessKey', microsoft365: 'clientSecret' } as const satisfies Record<MailProvider, string>;

export type SmtpBlock = { host: string; port: SmtpPort; username: string; password: string };
export type BrevoBlock = { apiKey: string };
export type SesBlock = { region: SesRegion; accessKeyId: string; secretAccessKey: string };
export type Microsoft365Block = { tenantId: string; clientId: string; clientSecret: string; mailbox: string };

export type MailSettings = {
  provider: MailProvider;
  /** `name` null = the studio name. */
  from: { email: string; name: string | null };
  replyTo: string | null;
  smtp?: SmtpBlock;
  brevo?: BrevoBlock;
  ses?: SesBlock;
  microsoft365?: Microsoft365Block;
};

export type MailSettingsResult = { ok: true; value: MailSettings } | { ok: false; field: string };

export const MAX_FROM_NAME_LENGTH = 100;
const MAX_ID_LENGTH = 128;
const ACCESS_KEY_ID_RE = /^[A-Z0-9]{16,128}$/;
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A From name: trimmed, ≤ 100 characters, nothing that could break a header. Empty = none. */
export function parseFromName(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const name = value.normalize('NFC').trim();
  if (!name) return { ok: true, value: null };
  return name.length <= MAX_FROM_NAME_LENGTH && isHeaderSafe(name) ? { ok: true, value: name } : { ok: false };
}

export const isSmtpPort = (value: unknown): value is SmtpPort => typeof value === 'number' && Object.hasOwn(SMTP_PORTS, value);
/** A login name: 1–254 characters, no control or separator character. */
export const isUsername = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 254 && value === value.trim() && isHeaderSafe(value);
export const isAccessKeyId = (value: unknown): value is string => typeof value === 'string' && ACCESS_KEY_ID_RE.test(value);
export const isClientId = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_ID_LENGTH && CLIENT_ID_RE.test(value);

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null);

/** A stored `mail` row → settings, or the first field that is wrong. */
export function parseMailSettings(value: unknown): MailSettingsResult {
  const row = record(value);
  if (!row) return { ok: false, field: 'mail' };
  const provider = row.provider;
  if (typeof provider !== 'string' || !(MAIL_PROVIDERS as readonly string[]).includes(provider)) return { ok: false, field: 'provider' };
  const from = record(row.from);
  const fromEmail = parseEmailAddress(from?.email);
  if (!from || !fromEmail) return { ok: false, field: 'from' };
  const fromName = parseFromName(from.name);
  if (!fromName.ok) return { ok: false, field: 'fromName' };
  let replyTo: string | null = null;
  if (row.replyTo !== null && row.replyTo !== undefined) {
    replyTo = parseEmailAddress(row.replyTo);
    if (!replyTo) return { ok: false, field: 'replyTo' };
  }
  const settings: MailSettings = { provider: provider as MailProvider, from: { email: fromEmail, name: fromName.value }, replyTo };
  const block = record(row[provider]);
  if (!block) return { ok: false, field: provider };
  const bad = (field: string): MailSettingsResult => ({ ok: false, field: `${provider}.${field}` });

  switch (settings.provider) {
    case 'smtp': {
      const { host, port, username, password } = block;
      if (typeof host !== 'string' || !isSmtpHost(host, { development: false })) return bad('host');
      if (!isSmtpPort(port)) return bad('port');
      if (!isUsername(username)) return bad('username');
      if (!isSealed(password)) return bad('password');
      settings.smtp = { host, port, username, password };
      break;
    }
    case 'brevo': {
      if (!isSealed(block.apiKey)) return bad('apiKey');
      settings.brevo = { apiKey: block.apiKey };
      break;
    }
    case 'ses': {
      const { region, accessKeyId, secretAccessKey } = block;
      if (!isSesRegion(region)) return bad('region');
      if (!isAccessKeyId(accessKeyId)) return bad('accessKeyId');
      if (!isSealed(secretAccessKey)) return bad('secretAccessKey');
      settings.ses = { region, accessKeyId, secretAccessKey };
      break;
    }
    case 'microsoft365': {
      const { tenantId, clientId, clientSecret } = block;
      if (!isTenantId(tenantId)) return bad('tenantId');
      if (!isClientId(clientId)) return bad('clientId');
      if (!isSealed(clientSecret)) return bad('clientSecret');
      const mailbox = parseEmailAddress(block.mailbox);
      if (!mailbox) return bad('mailbox');
      settings.microsoft365 = { tenantId, clientId, clientSecret, mailbox };
      break;
    }
  }
  return { ok: true, value: settings };
}
