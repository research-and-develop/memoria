import 'server-only';

import type { Options } from '@repo/db/client';
import { logger } from '@repo/logger';
import { getPlatform } from '@repo/platform/current';
import { MailError } from '@repo/platform/mail/error';
import type { MailTransport } from '@repo/platform/mail/transport';
import type { MailAddress } from '@repo/platform/ports';
import { SMTP_PORTS } from '@repo/platform/mail/smtpHost';

import { getSiteSetting } from '@/lib/db/queries/site_settings';

import { MAIL_SECRET_FIELD, parseMailSettings, type MailSettings } from './parseMailSettings';
import { mailSecretAad, settingsCipher } from './secrets';

export type { MailSettings } from './parseMailSettings';

/** The `site_settings` key of the mail settings (plan p03, D3.17). */
export const MAIL_SETTING_KEY = 'mail';

/**
 * How email goes out right now, secrets in the clear: from the studio's settings (`database`), else
 * the env fallback `MAIL_FROM` + `SMTP_*` (`env`, development). `from.name` undefined = the studio
 * name (the email job fills it in).
 */
export type MailSetup = { source: 'database' | 'env'; from: MailAddress; replyTo: MailAddress | null; transport: MailTransport };

/**
 * The stored mail settings, or null when none are saved. An invalid row is logged
 * (`mail_settings_invalid`, the field only) and treated as none. No React: the relay reads it too.
 */
export async function readMailSettings(opts?: Options): Promise<MailSettings | null> {
  const value = (await getSiteSetting(MAIL_SETTING_KEY, opts))?.value;
  if (value === undefined) return null;
  const parsed = parseMailSettings(value);
  if (!parsed.ok) {
    logger.warn({ event: 'mail_settings_invalid', field: parsed.field });
    return null;
  }
  return parsed.value;
}

/** How to send now: the saved settings unsealed, else the env fallback, else null (not configured). */
export async function readMailSetup(opts?: Options): Promise<MailSetup | null> {
  const stored = await readMailSettings(opts);
  if (stored) return unsealMailSettings(stored);
  const env = getPlatform().config().bootstrap.mail;
  return env ? { source: 'env', from: { email: env.from }, replyTo: null, transport: { provider: 'smtp', smtp: env.smtp } } : null;
}

/** Email can be sent: mail settings are saved, or the env fallback is set (development). */
export async function isMailConfigured(opts?: Options): Promise<boolean> {
  return (await readMailSettings(opts)) !== null || getPlatform().config().bootstrap.mail !== null;
}

/** Why the env fallback is off although it is half set (`SMTP_PORT must be a port number`), or null. */
export function envMailProblem(): string | null {
  return getPlatform().config().bootstrap.mailProblem;
}

/**
 * Stored settings with their secret decrypted. Throws a configuration `MailError` (retried; the
 * admin enters the secret again): `SETTINGS_KEY_MISSING` without `SETTINGS_ENCRYPTION_KEY`,
 * `MAIL_SECRET_UNREADABLE` when it does not decrypt (another key; logged `settings_key_mismatch`).
 */
export async function unsealMailSettings(settings: MailSettings): Promise<MailSetup> {
  const key = getPlatform().config().settingsKey;
  if (!key) throw new MailError('SETTINGS_KEY_MISSING', { configuration: true });
  const cipher = await settingsCipher(key);
  const field = MAIL_SECRET_FIELD[settings.provider];
  const reveal = async (sealed: string): Promise<string> => {
    const plain = await cipher.decrypt(sealed, mailSecretAad(settings.provider, field));
    if (plain === null) {
      logger.error({ event: 'settings_key_mismatch', provider: settings.provider, field });
      throw new MailError('MAIL_SECRET_UNREADABLE', { configuration: true, detail: `${settings.provider}.${field}` });
    }
    return plain;
  };
  const base = {
    source: 'database' as const,
    from: settings.from.name ? { email: settings.from.email, name: settings.from.name } : { email: settings.from.email },
    replyTo: settings.replyTo ? { email: settings.replyTo } : null,
  };
  const missing = () => new MailError('MAIL_NOT_CONFIGURED', { configuration: true, detail: settings.provider });
  switch (settings.provider) {
    case 'smtp': {
      const smtp = settings.smtp;
      if (!smtp) throw missing();
      const password = await reveal(smtp.password);
      return { ...base, transport: { provider: 'smtp', smtp: { host: smtp.host, port: smtp.port, security: SMTP_PORTS[smtp.port], username: smtp.username, password } } };
    }
    case 'brevo': {
      if (!settings.brevo) throw missing();
      return { ...base, transport: { provider: 'brevo', brevo: { apiKey: await reveal(settings.brevo.apiKey) } } };
    }
    case 'ses': {
      const ses = settings.ses;
      if (!ses) throw missing();
      return { ...base, transport: { provider: 'ses', ses: { region: ses.region, accessKeyId: ses.accessKeyId, secretAccessKey: await reveal(ses.secretAccessKey) } } };
    }
    case 'microsoft365': {
      const m = settings.microsoft365;
      if (!m) throw missing();
      return { ...base, transport: { provider: 'microsoft365', microsoft365: { tenantId: m.tenantId, clientId: m.clientId, mailbox: m.mailbox, clientSecret: await reveal(m.clientSecret) } } };
    }
  }
}
