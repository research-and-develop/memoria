import { describe, expect, it } from 'vitest';

import { emailContext } from '../context';

import { SECURITY_TEMPLATES } from './security';

const AT = '2026-11-16T10:05:00.000Z';
const withSite = emailContext({ name: 'Lumen', siteUrl: 'https://photos.example.com' });
const noSite = emailContext({ name: 'Lumen', siteUrl: null });

/** Good parameters for each template. */
const GOOD: Record<string, Record<string, unknown>> = {
  'security.sign-in': { at: AT, method: 'code', device: 'Chrome on macOS', country: 'BG' },
  'security.authenticator-added': { at: AT, label: 'Phone' },
  'security.authenticator-removed': { at: AT, label: 'Phone' },
  'security.recovery-codes-regenerated': { at: AT },
  'security.recovery-code-used': { at: AT },
  'security.email-changed': { at: AT, role: 'old' },
  'security.password-changed': { at: AT },
  'security.mail-settings-changed': { at: AT, provider: 'Brevo', fromDomain: 'lumen.example' },
  'security.notices-off': { at: AT },
  'security.locked': { at: AT },
};

describe('security notice templates', () => {
  it('every template has good parameters here', () => {
    expect(SECURITY_TEMPLATES.map((t) => t.id).sort()).toEqual(Object.keys(GOOD).sort());
  });

  it.each(SECURITY_TEMPLATES.map((t) => [t.id, t] as const))('%s renders a subject, text and HTML with the time; no code or secret', (id, template) => {
    const params = template.parse(GOOD[id]);
    expect(params).not.toBeNull();
    const email = template.render(params as never, withSite);
    expect(email.subject).toMatch(/· Lumen$/);
    expect(email.text).toContain('16 Nov 2026, 10:05 (UTC)');
    expect(email.html).toContain('16 Nov 2026, 10:05 (UTC)');
    // Nothing that acts: no code-looking digits, no token, only the plain Settings link.
    expect(email.text).not.toMatch(/\b\d{6}\b|token|secret=/i);
    const links = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(['https://photos.example.com/admin/settings/security']);
  });

  it.each(SECURITY_TEMPLATES.map((t) => [t.id, t] as const))('%s: no link when the website address is not known', (id, template) => {
    const email = template.render(template.parse(GOOD[id]) as never, noSite);
    expect(email.html).not.toContain('href=');
  });

  it('escapes a label', () => {
    const template = SECURITY_TEMPLATES.find((t) => t.id === 'security.authenticator-added')!;
    const email = template.render(template.parse({ at: AT, label: '<script>alert(1)</script>' }) as never, withSite);
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it.each([
    ['security.sign-in', { at: AT, method: 'password', device: 'x', country: null }],
    ['security.sign-in', { at: AT, method: 'code', device: 'x', country: 'bg' }],
    ['security.sign-in', { at: AT, method: 'code', device: 'x'.repeat(81), country: null }],
    ['security.authenticator-added', { at: AT, label: 'a\u0000b' }],
    ['security.authenticator-removed', { at: 'yesterday', label: 'Phone' }],
    ['security.email-changed', { at: AT, role: 'both' }],
    ['security.mail-settings-changed', { at: AT, provider: 'Brevo', fromDomain: 'Lumen Example' }],
    ['security.locked', {}],
    ['security.password-changed', null],
  ])('%s refuses %j', (id, params) => {
    expect(SECURITY_TEMPLATES.find((t) => t.id === id)!.parse(params)).toBeNull();
  });
});
