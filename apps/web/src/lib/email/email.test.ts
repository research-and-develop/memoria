import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { JobRow } from '@/lib/db/queries/jobs/types';

import { emailContext } from './context';
import { escapeHtml, renderLayout } from './layout';
import { renderEmail, templateLabel } from './templates/registry';
import { errorSentence, toEmailView } from './views';

const studio = { name: 'Studio <Lumen> & "Co"', siteUrl: 'https://photos.example.com' };

describe('emailContext.link', () => {
  const ctx = emailContext(studio);
  it('joins the website address and a site path', () => {
    expect(ctx.link('/g/abc?x=1')).toBe('https://photos.example.com/g/abc?x=1');
  });

  it.each(['g/abc', '//evil.example', '/\\evil', 'https://evil.example', '/a b', ''])('refuses %j', (bad) => {
    expect(() => ctx.link(bad)).toThrow(/not a site path/);
  });

  it('without a website address → SITE_URL_MISSING (retried)', () => {
    expect(() => emailContext({ name: 'S', siteUrl: null }).link('/x')).toThrow(expect.objectContaining({ code: 'SITE_URL_MISSING', permanent: false }));
  });
});

describe('renderLayout', () => {
  it('escapes every value; text and HTML both carry the content', () => {
    const { html, text } = renderLayout(emailContext(studio), {
      heading: '<script>alert(1)</script>',
      paragraphs: ['Tom & "Jerry"', "it's <b>"],
      action: { label: 'Open', href: 'https://photos.example.com/g/a?b=1&c="2"' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Studio &lt;Lumen&gt; &amp; &quot;Co&quot;');
    expect(html).toContain('href="https://photos.example.com/g/a?b=1&amp;c=&quot;2&quot;"');
    expect(html).toContain('it&#39;s &lt;b&gt;');
    expect(text).toContain('Tom & "Jerry"');
    expect(text).toContain('Open: https://photos.example.com/g/a?b=1&c="2"');
    expect(text).toContain('Studio <Lumen> & "Co" · https://photos.example.com');
  });

  it('takes its colours from the theme (no literal in the source)', () => {
    const { html } = renderLayout(emailContext(studio), { heading: 'h', paragraphs: [] });
    expect(html).toMatch(/background:#[0-9A-F]{6}/i);
    const source = readFileSync(path.join(__dirname, 'layout.ts'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('the test template', () => {
  it('renders a subject, a text and an HTML part', () => {
    const email = renderEmail('test', { queuedAt: '2026-11-16T10:05:00.000Z' }, emailContext({ name: 'Lumen', siteUrl: null }));
    expect(email.subject).toBe('Test email from Lumen');
    expect(email.text).toContain('16 Nov 2026, 10:05');
    expect(email.html).toContain('Email works');
    expect(templateLabel('test')).toBe('Test email');
    expect(templateLabel('gone')).toBe('gone');
  });

  it.each([[{}], [{ queuedAt: 'soon' }], [null]])('refuses parameters %j', (params) => {
    expect(() => renderEmail('test', params, emailContext(studio))).toThrow(/bad parameters/);
  });

  it('refuses an unknown template', () => {
    expect(() => renderEmail('nope', {}, emailContext(studio))).toThrow(/no template/);
  });

  it('templates and the layout stay importable by the app and the relay: no server-only; the platform and D1 only in a load step', () => {
    const dir = path.join(__dirname, 'templates');
    const templates = readdirSync(dir).filter((f) => !f.endsWith('.test.ts'));
    const files = [...templates.map((f) => path.join(dir, f)), path.join(__dirname, 'layout.ts'), path.join(__dirname, 'context.ts'), path.join(__dirname, 'views.ts')];
    expect(files.length).toBeGreaterThan(4);
    let loaders = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from 'server-only'|import 'server-only'/);
      // A template with a `load` step (D5.20) reads D1 at send time; everything else stays pure.
      if (/^ {2}async load\(/m.test(source)) loaders += 1;
      else expect(source, file).not.toMatch(/@repo\/platform\/current|@repo\/db\/client/);
    }
    expect(loaders).toBe(1);
  });
});

describe('toEmailView', () => {
  const job = (over: Partial<JobRow>): JobRow => ({
    id: 'j1',
    kind: 'email',
    payload: { v: 1, template: 'test', to: { email: 'client@example.org' } },
    status: 'pending',
    priority: 0,
    attempts: 0,
    max_attempts: 6,
    run_after: '2026-11-16T10:00:00.000Z',
    ref: null,
    dedupe_key: null,
    last_error: null,
    created_at: '2026-11-16T09:59:00.000Z',
    updated_at: '2026-11-16T09:59:00.000Z',
    finished_at: null,
    ...over,
  });
  const labels = { templateLabel: 'Test email', accountLabel: 'You' };

  it.each([
    ['pending, never tried', { status: 'pending', attempts: 0 }, 'queued', '2026-11-16T10:00:00.000Z', false],
    ['pending after a try', { status: 'pending', attempts: 2, last_error: 'SMTP_451' }, 'retrying', '2026-11-16T10:00:00.000Z', false],
    ['running', { status: 'running', attempts: 1 }, 'sending', null, false],
    ['done', { status: 'done', attempts: 1, finished_at: '2026-11-16T10:00:01.000Z' }, 'sent', null, false],
    ['failed', { status: 'failed', attempts: 6, last_error: 'SMTP_550: rejected' }, 'failed', null, true],
  ] as const)('%s → %s', (_label, over, status, nextAttemptAt, canRetry) => {
    expect(toEmailView(job(over), labels)).toMatchObject({ status, nextAttemptAt, canRetry, templateLabel: 'Test email', to: 'client@example.org' });
  });

  it('the account recipient shows the account label', () => {
    expect(toEmailView(job({ payload: { v: 1, template: 'test', to: { account: true } } }), labels).to).toBe('You');
  });

  it.each([
    ['SMTP_535', 'The mail server refused the username or password.'],
    ['SMTP_550: 5.1.1 *** unknown', 'The mail server refused the email.'],
    ['SMTP_421', 'The mail server asked to try again later.'],
    ['BREVO_401: Key not found', 'The email provider refused the request: see the reason.'],
    ['GRAPH_TOKEN_400', 'The email provider refused the request: see the reason.'],
    ['MAIL_NOT_CONFIGURED', 'Email is not set up: choose how to send it in Settings → Emails.'],
    ['SOMETHING_NEW', null],
  ])('errorSentence(%j)', (lastError, sentence) => {
    expect(errorSentence(lastError)).toBe(sentence);
  });
});
