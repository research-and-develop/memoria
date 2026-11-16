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

/** What a provider is called on screen and in the notice that the settings changed. */
export const MAIL_PROVIDER_LABELS: Record<MailProvider, string> = {
  smtp: 'SMTP server',
  brevo: 'Brevo',
  ses: 'Amazon SES',
  microsoft365: 'Microsoft 365',
};

export type MailInputResult =
  | {
      ok: true;
      /** The settings to store; the provider's secret is '' here (sealed by the route). */
      value: MailSettings;
      /** The new secret in the clear, or null = keep the saved one. */
      secret: string | null;
    }
  | { ok: false; field: string; message: string; errorCode?: 'SECRET_REQUIRED' };

const MAX_SECRET_LENGTH = 1024;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Settings → Emails as submitted (plan p03, D3.17): every field checked like a stored row, the
 * secret in the clear. An empty secret keeps the saved one only when the provider and every other
 * field of its block are unchanged; otherwise `SECRET_REQUIRED`: a saved credential never goes to a
 * new host, account or tenant. Pure: the form runs it too.
 */
export function parseMailSettingsInput(body: unknown, saved: MailSettings | null): MailInputResult {
  const row = record(body) ?? {};
  const provider = row.provider;
  if (typeof provider !== 'string' || !(MAIL_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, field: 'provider', message: 'Choose how to send email.' };
  }
  const p = provider as MailProvider;
  const from = record(row.from) ?? {};
  const fromEmail = parseEmailAddress(from.email);
  if (!fromEmail) return { ok: false, field: 'from.email', message: 'Enter the address emails are sent from, such as hello@yourstudio.com.' };
  const fromName = parseFromName(from.name);
  if (!fromName.ok) return { ok: false, field: 'from.name', message: `Keep the sender name to ${MAX_FROM_NAME_LENGTH} characters, without line breaks.` };
  let replyTo: string | null = null;
  if (text(row.replyTo)) {
    replyTo = parseEmailAddress(row.replyTo);
    if (!replyTo) return { ok: false, field: 'replyTo', message: 'Enter a valid reply-to address, or leave it empty.' };
  }
  const block = record(row[p]) ?? {};
  const bad = (field: string, message: string): MailInputResult => ({ ok: false, field: `${p}.${field}`, message });
  const secretField = MAIL_SECRET_FIELD[p];
  const rawSecret = typeof block[secretField] === 'string' ? (block[secretField] as string) : '';
  if (rawSecret.length > MAX_SECRET_LENGTH) return bad(secretField, 'That is too long for a password or key.');
  const secret = rawSecret.trim() || null;
  const settings: MailSettings = { provider: p, from: { email: fromEmail, name: fromName.value }, replyTo };

  switch (p) {
    case 'smtp': {
      const host = text(block.host).toLowerCase();
      const port = typeof block.port === 'string' ? Number(block.port) : block.port;
      const username = text(block.username);
      if (!isSmtpHost(host, { development: false })) return bad('host', 'Enter the server’s name, such as smtp.example.com (not an IP address).');
      if (!isSmtpPort(port)) return bad('port', 'Choose port 587, 465 or 2525.');
      if (!isUsername(username)) return bad('username', 'Enter the username (often the full email address).');
      settings.smtp = { host, port, username, password: '' };
      break;
    }
    case 'brevo':
      settings.brevo = { apiKey: '' };
      break;
    case 'ses': {
      const region = text(block.region);
      const accessKeyId = text(block.accessKeyId);
      if (!isSesRegion(region)) return bad('region', 'Choose the region of your verified domain.');
      if (!isAccessKeyId(accessKeyId)) return bad('accessKeyId', 'Enter the access key ID (capital letters and digits, such as AKIA…).');
      settings.ses = { region, accessKeyId, secretAccessKey: '' };
      break;
    }
    case 'microsoft365': {
      const tenantId = text(block.tenantId);
      const clientId = text(block.clientId);
      const mailbox = parseEmailAddress(block.mailbox) ?? (text(block.mailbox) ? null : fromEmail);
      if (!isTenantId(tenantId)) return bad('tenantId', 'Enter the tenant ID (a GUID) or your domain, such as yourstudio.onmicrosoft.com.');
      if (!isClientId(clientId)) return bad('clientId', 'Enter the application (client) ID, a GUID.');
      if (!mailbox) return bad('mailbox', 'Enter the mailbox that sends, or leave it empty to use the From address.');
      settings.microsoft365 = { tenantId, clientId, clientSecret: '', mailbox };
      break;
    }
  }

  if (secret === null && !sameBlockExceptSecret(settings, saved)) {
    return {
      ok: false,
      field: `${p}.${secretField}`,
      message: saved?.provider === p ? 'Enter the password or key again: other details of this provider changed.' : 'Enter the password or key.',
      errorCode: 'SECRET_REQUIRED',
    };
  }
  return { ok: true, value: settings, secret };
}

/** The provider and every non-secret field of its block are as saved. */
function sameBlockExceptSecret(next: MailSettings, saved: MailSettings | null): boolean {
  if (!saved || saved.provider !== next.provider) return false;
  const strip = (s: MailSettings) => {
    const block = { ...(s[s.provider] as Record<string, unknown> | undefined) };
    delete block[MAIL_SECRET_FIELD[s.provider]];
    return JSON.stringify(Object.keys(block).sort().map((k) => [k, block[k]]));
  };
  return strip(next) === strip(saved);
}

/** The settings as the browser may see them: never a secret, only whether one is saved. */
export type MailSettingsView = Omit<MailSettings, 'smtp' | 'brevo' | 'ses' | 'microsoft365'> & {
  smtp?: Omit<SmtpBlock, 'password'>;
  ses?: Omit<SesBlock, 'secretAccessKey'>;
  microsoft365?: Omit<Microsoft365Block, 'clientSecret'>;
  secretSaved: boolean;
};

export function toMailSettingsView(settings: MailSettings): MailSettingsView {
  const view: MailSettingsView = { provider: settings.provider, from: settings.from, replyTo: settings.replyTo, secretSaved: true };
  if (settings.smtp) view.smtp = { host: settings.smtp.host, port: settings.smtp.port, username: settings.smtp.username };
  if (settings.ses) view.ses = { region: settings.ses.region, accessKeyId: settings.ses.accessKeyId };
  if (settings.microsoft365) view.microsoft365 = { tenantId: settings.microsoft365.tenantId, clientId: settings.microsoft365.clientId, mailbox: settings.microsoft365.mailbox };
  return view;
}

/**
 * The saved settings as `parseMailSettingsInput` needs them for its keep-the-secret rule, rebuilt
 * from the view (the form has no secret: a placeholder stands in for it).
 */
export function settingsFromView(view: MailSettingsView): MailSettings {
  const settings: MailSettings = { provider: view.provider, from: view.from, replyTo: view.replyTo };
  const placeholder = 'v1:saved';
  if (view.provider === 'smtp' && view.smtp) settings.smtp = { ...view.smtp, password: placeholder };
  if (view.provider === 'brevo') settings.brevo = { apiKey: placeholder };
  if (view.provider === 'ses' && view.ses) settings.ses = { ...view.ses, secretAccessKey: placeholder };
  if (view.provider === 'microsoft365' && view.microsoft365) settings.microsoft365 = { ...view.microsoft365, clientSecret: placeholder };
  return settings;
}
