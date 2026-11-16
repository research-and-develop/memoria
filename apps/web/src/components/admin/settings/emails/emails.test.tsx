import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailView } from '@/lib/email/views';

import { SecondFactorProvider } from '../../security/SecondFactor';
import { MailProviderForm } from './MailProviderForm';
import { RecentEmails } from './RecentEmails';
import { EmailStatusLine, GIVE_UP_MS, POLL_MS, TestEmailForm } from './TestEmailForm';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/settings/emails' }));

type Reply = { status: number; body: unknown } | 'network';
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0])}`);
const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)) as Record<string, unknown>;

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift() ?? { status: 200, body: { data: {} } };
    if (r === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const email = (over: Partial<EmailView> = {}): EmailView => ({
  id: '0f3c1e2d-4b5a-4789-abcd-ef0123456789',
  template: 'test',
  templateLabel: 'Test email',
  to: 'me@example.com',
  status: 'queued',
  attempts: 0,
  maxAttempts: 1,
  lastError: null,
  createdAt: '2026-11-16T10:00:00.000Z',
  finishedAt: null,
  nextAttemptAt: '2026-11-16T10:00:00.000Z',
  canRetry: false,
  ...over,
});
const ok = (data: unknown) => ({ status: 200, body: { data } });

describe('TestEmailForm', () => {
  it('defaults to the account email, sends, then shows the live status', async () => {
    replies = [{ status: 202, body: { data: email() } }];
    render(<TestEmailForm defaultTo="owner@example.com" configured />);
    expect(screen.getByLabelText('Send to')).toHaveValue('owner@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(calls()).toEqual(['POST /api/admin/emails/test']);
    expect(bodyOf(0)).toEqual({ to: 'owner@example.com' });
    expect(await screen.findByRole('status')).toHaveTextContent('Queued');
  });

  it('shows the server’s reason (e.g. the hourly limit)', async () => {
    replies = [{ status: 429, body: { error: 'Too many', errorCode: 'RATE_LIMITED', details: { message: 'You can send 3 test emails an hour. Try again later.' } } }];
    render(<TestEmailForm defaultTo="owner@example.com" configured />);
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('3 test emails an hour');
  });

  it('cannot send before email is set up', () => {
    render(<TestEmailForm defaultTo="" configured={false} />);
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled();
    expect(screen.getByText('Save how to send email first.')).toBeInTheDocument();
  });
});

describe('EmailStatusLine', () => {
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('polls every 2 s: queued → sending → sent, then stops and refreshes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    replies = [ok(email({ status: 'sending' })), ok(email({ status: 'sent' }))];
    render(<EmailStatusLine initial={email()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Queued');
    await advance(POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Sending');
    await advance(POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Sent. Check the inbox.');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) await advance(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failure shows the sentence and the code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    replies = [ok(email({ status: 'failed', lastError: 'SMTP_535: 5.7.8 bad credentials' }))];
    render(<EmailStatusLine initial={email()} />);
    await advance(POLL_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Failed: The mail server refused the username or password.');
    expect(screen.getByText('SMTP_535: 5.7.8 bad credentials')).toBeInTheDocument();
  });

  it('after a minute still queued: the relay hint; a network error kept it trying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    replies = Array.from({ length: 40 }, (_, i) => (i === 0 ? 'network' : ok(email())));
    render(<EmailStatusLine initial={email()} />);
    // One act per poll: React re-arms the timer after each state update.
    for (let t = 0; t <= GIVE_UP_MS; t += POLL_MS) await advance(POLL_MS);
    expect(screen.getByText(/background worker has not picked it up/)).toBeInTheDocument();
    const polls = fetchMock.mock.calls.length;
    expect(polls).toBeGreaterThan(25);
    for (let i = 0; i < 5; i++) await advance(POLL_MS);
    expect(fetchMock.mock.calls.length).toBe(polls);
  });

  it.each([
    ['the session ended (401)', { status: 401, body: { error: 'Unauthorized', errorCode: 'UNAUTHORIZED' } }, /signed out/],
    ['it is gone (404)', { status: 404, body: { error: 'Not found', errorCode: 'NOT_FOUND' } }, null],
  ])('stops when %s', async (_label, reply, text) => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    replies = [reply];
    render(<EmailStatusLine initial={email()} />);
    await advance(POLL_MS);
    if (text) expect(screen.getByText(text)).toBeInTheDocument();
    for (let i = 0; i < 3; i++) await advance(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops polling when unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { unmount } = render(<EmailStatusLine initial={email()} />);
    unmount();
    await advance(POLL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RecentEmails', () => {
  it('empty state', () => {
    render(<RecentEmails emails={[]} notSending={false} />);
    expect(screen.getByText('No emails yet.')).toBeInTheDocument();
  });

  it('pills, the reason as text, Retry only on a failed email', async () => {
    replies = [ok(email({ status: 'queued' }))];
    render(
      <RecentEmails
        notSending
        emails={[
          email({ id: 'a', status: 'sent' }),
          email({ id: 'b', status: 'failed', lastError: 'SMTP_550: <b>rejected</b>', canRetry: true }),
          email({ id: 'c', status: 'retrying', lastError: 'SMTP_451', attempts: 2 }),
        ]}
      />,
    );
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText(/\(SMTP_550: <b>rejected<\/b>\)/)).toBeInTheDocument();
    expect(screen.getByText(/background worker is not running/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Retry' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(calls()).toEqual(['POST /api/admin/emails/b/retry']);
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('MailProviderForm', () => {
  const renderForm = (props: Partial<Parameters<typeof MailProviderForm>[0]> = {}) =>
    render(
      <SecondFactorProvider>
        <MailProviderForm saved={null} usingEnvFallback={false} canSave studioName="Lumen" {...props} />
      </SecondFactorProvider>,
    );

  it('shows only the chosen provider’s fields', async () => {
    renderForm();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Send with'), 'smtp');
    expect(screen.getByLabelText('Server')).toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Send with'), 'microsoft365');
    expect(screen.getByLabelText('Tenant ID')).toBeInTheDocument();
  });

  it('checks the fields before sending: a missing key', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('From address'), 'hello@lumen.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the password or key.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a saved secret is never shown: "Saved — leave empty to keep", and saving keeps it', async () => {
    replies = [ok({ provider: 'brevo', from: { email: 'hello@lumen.example', name: null }, replyTo: null, secretSaved: true })];
    renderForm({ saved: { provider: 'brevo', from: { email: 'hello@lumen.example', name: null }, replyTo: null, secretSaved: true } });
    const key = screen.getByLabelText('API key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('placeholder', 'Saved — leave empty to keep');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls()).toEqual(['PUT /api/admin/settings/mail']);
    expect(bodyOf(0)).toMatchObject({ provider: 'brevo', brevo: { apiKey: '' } });
  });

  it('cannot save without the server key', () => {
    renderForm({ canSave: false });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/SETTINGS_ENCRYPTION_KEY/)).toBeInTheDocument();
  });
});
