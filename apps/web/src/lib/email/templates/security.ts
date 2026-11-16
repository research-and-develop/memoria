import { dateTimeLabel } from '@/lib/dates';

import { renderLayout } from '../layout';
import type { EmailContext, EmailTemplate, RenderedEmail } from '../types';

/**
 * Security notices to the account email (plan p03, D3.19). Parameters are labels, a country code
 * and a time: never a code, a secret, a count or a link that acts. The only link is a plain one to
 * Settings → Security, when the website address is known.
 */
type At = { at: string };

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
/** A short label (a device, an app name): ≤ 80 characters, no control or bidi character. */
const isLabel = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value);
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null);

const NOT_YOU =
  'If this was not you, sign in and check Settings → Security: remove what you do not recognise and change your password. If you cannot sign in, ask the person who installed Memoria to reset your sign-in.';

function notice(ctx: EmailContext, subject: string, heading: string, lines: string[], opts: { notYou?: boolean } = {}): RenderedEmail {
  const paragraphs = opts.notYou === false ? lines : [...lines, NOT_YOU];
  const action = ctx.siteUrl ? { label: 'Open Settings → Security', href: ctx.link('/admin/settings/security') } : undefined;
  return { subject: `${subject} · ${ctx.studioName}`, ...renderLayout(ctx, { heading, paragraphs, ...(action ? { action } : {}) }) };
}

const when = (at: string) => `${dateTimeLabel(at)} (UTC)`;

/** A template whose parameters are only `{ at }`. */
function atOnly(id: string, label: string, subject: string, heading: string, line: (at: string) => string, opts: { notYou?: boolean } = {}): EmailTemplate<At> {
  return {
    id,
    label,
    parse: (params) => {
      const p = record(params);
      return p && isIso(p.at) ? { at: p.at } : null;
    },
    render: ({ at }, ctx) => notice(ctx, subject, heading, [line(at)], opts),
  };
}

export type SignInMethod = 'code' | 'recovery-code' | 'setup';
const METHODS: Record<SignInMethod, string> = {
  code: 'a code from an authenticator app',
  'recovery-code': 'a recovery code',
  setup: 'a setup code (a new authenticator app was added)',
};

export const signInNotice: EmailTemplate<At & { method: SignInMethod; device: string; country: string | null }> = {
  id: 'security.sign-in',
  label: 'Security: new sign-in',
  parse(params) {
    const p = record(params);
    if (!p || !isIso(p.at) || typeof p.method !== 'string' || !Object.hasOwn(METHODS, p.method) || !isLabel(p.device)) return null;
    const country = p.country === null || p.country === undefined ? null : typeof p.country === 'string' && /^[A-Z]{2}$/.test(p.country) ? p.country : undefined;
    if (country === undefined) return null;
    return { at: p.at, method: p.method as SignInMethod, device: p.device, country };
  },
  render({ at, method, device, country }, ctx) {
    const where = country ? ` from ${country}` : '';
    return notice(ctx, 'New sign-in', 'Someone signed in to your studio', [`${when(at)}: a sign-in on ${device}${where}, with ${METHODS[method]}.`]);
  },
};

const appLabel = (id: string, label: string, subject: string, heading: string, verb: string): EmailTemplate<At & { label: string }> => ({
  id,
  label,
  parse(params) {
    const p = record(params);
    return p && isIso(p.at) && isLabel(p.label) ? { at: p.at, label: p.label } : null;
  },
  render: ({ at, label: app }, ctx) => notice(ctx, subject, heading, [`${when(at)}: the authenticator app “${app}” was ${verb}.`]),
});

export const authenticatorAddedNotice = appLabel('security.authenticator-added', 'Security: authenticator added', 'Authenticator added', 'An authenticator app was added', 'added to your sign-in');
export const authenticatorRemovedNotice = appLabel('security.authenticator-removed', 'Security: authenticator removed', 'Authenticator removed', 'An authenticator app was removed', 'removed from your sign-in');

export const recoveryCodesRegeneratedNotice = atOnly(
  'security.recovery-codes-regenerated',
  'Security: new recovery codes',
  'New recovery codes',
  'New recovery codes were made',
  (at) => `${when(at)}: new recovery codes were made for your sign-in. The old ones no longer work.`,
);

export const recoveryCodeUsedNotice = atOnly(
  'security.recovery-code-used',
  'Security: recovery code used',
  'Recovery code used',
  'A recovery code was used',
  (at) => `${when(at)}: a recovery code was used to confirm a change in Settings. Each code works once.`,
);

export const emailChangedNotice: EmailTemplate<At & { role: 'old' | 'new' }> = {
  id: 'security.email-changed',
  label: 'Security: sign-in email changed',
  parse(params) {
    const p = record(params);
    return p && isIso(p.at) && (p.role === 'old' || p.role === 'new') ? { at: p.at, role: p.role } : null;
  },
  render({ at, role }, ctx) {
    return role === 'old'
      ? notice(ctx, 'Sign-in email changed', 'Your sign-in email was changed', [`${when(at)}: the sign-in email of your studio was changed from this address to another one. Security emails now go there.`])
      : notice(ctx, 'Sign-in email changed', 'This is now your sign-in email', [`${when(at)}: this address became the sign-in email of your studio. Security emails will come here.`]);
  },
};

export const passwordChangedNotice = atOnly(
  'security.password-changed',
  'Security: password changed',
  'Password changed',
  'Your password was changed',
  (at) => `${when(at)}: the password of your studio was changed and every other device was signed out.`,
);

export const mailSettingsChangedNotice: EmailTemplate<At & { provider: string; fromDomain: string }> = {
  id: 'security.mail-settings-changed',
  label: 'Security: email settings changed',
  parse(params) {
    const p = record(params);
    if (!p || !isIso(p.at) || !isLabel(p.provider) || typeof p.fromDomain !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(p.fromDomain)) return null;
    return { at: p.at, provider: p.provider, fromDomain: p.fromDomain };
  },
  render({ at, provider, fromDomain }, ctx) {
    return notice(ctx, 'Email settings changed', 'How your studio sends email changed', [
      `${when(at)}: emails are now sent through ${provider}, from an address at ${fromDomain}.`,
      'This message went out through the previous settings.',
    ]);
  },
};

export const noticesOffNotice = atOnly(
  'security.notices-off',
  'Security: notices turned off',
  'Security emails turned off',
  'Security emails were turned off',
  (at) => `${when(at)}: security emails were turned off in Settings → Emails. This is the last one until they are turned on again.`,
);

export const lockedNotice = atOnly(
  'security.locked',
  'Security: sign-in locked',
  'Sign-in locked',
  'Sign-in is locked until midnight UTC',
  (at) => `${when(at)}: too many wrong codes were entered today, so sign-in is locked until midnight UTC.`,
);

export const SECURITY_TEMPLATES = [
  signInNotice,
  authenticatorAddedNotice,
  authenticatorRemovedNotice,
  recoveryCodesRegeneratedNotice,
  recoveryCodeUsedNotice,
  emailChangedNotice,
  passwordChangedNotice,
  mailSettingsChangedNotice,
  noticesOffNotice,
  lockedNotice,
] as const;
