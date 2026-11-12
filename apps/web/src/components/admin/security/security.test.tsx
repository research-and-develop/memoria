import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useApi } from '@repo/ui/hooks/useApi';

import { recoveryBannerMessage } from '../RecoveryCodesBanner';
import { AuthenticatorsSection } from './AuthenticatorsSection';
import { recoveryTone } from './RecoveryCodesSection';
import { SecondFactorProvider, useConfirmThen } from './SecondFactor';
import { SessionsSection, type SessionItem } from './SessionsSection';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/settings/security' }));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0])}`);
const needsCode: Reply = {
  status: 403,
  body: { error: 'x', errorCode: 'SECOND_FACTOR_REQUIRED', details: { message: 'Enter a code to continue.' } },
};

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift() ?? { status: 200, body: { data: {} } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

/** A button whose action needs a recent code. */
function Protected() {
  const confirmThen = useConfirmThen();
  const api = useApi('/api/admin/thing', { method: 'POST' });
  const [outcome, setOutcome] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          const r = await confirmThen(() => api.execute({}));
          setOutcome(r.error ? r.error.errorCode : 'done');
        }}
      >
        Do it
      </button>
      <output>{outcome}</output>
    </>
  );
}

const renderProtected = () =>
  render(
    <SecondFactorProvider>
      <Protected />
    </SecondFactorProvider>,
  );
const codeDialog = () => screen.getByRole('dialog', { name: 'Confirm it is you' });

describe('confirm with a code', () => {
  it('asks for a code when the action needs one, then runs it again, once', async () => {
    replies.push(needsCode, { status: 200, body: { data: { verifiedUntil: 'x' } } }, { status: 200, body: { data: {} } });
    renderProtected();
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await userEvent.type(within(codeDialog()).getByLabelText('Code from your authenticator app'), '123456');
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(calls()).toEqual(['POST /api/admin/thing', 'POST /api/admin/second-factor', 'POST /api/admin/thing']);
  });

  it('a wrong code keeps the dialog open with the message', async () => {
    replies.push(needsCode, { status: 401, body: { error: 'x', errorCode: 'CODE_INVALID', details: { message: 'That code did not work. 4 tries left.', attemptsLeft: 4 } } });
    renderProtected();
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await userEvent.type(within(codeDialog()).getByLabelText('Code from your authenticator app'), '000000');
    expect(await within(codeDialog()).findByRole('alert')).toHaveTextContent('4 tries left');
    expect(codeDialog()).toHaveAttribute('open');
    expect(calls()).toHaveLength(2);
  });

  it('offers a recovery code', async () => {
    replies.push(needsCode, { status: 200, body: { data: { verifiedUntil: 'x' } } }, { status: 200, body: { data: {} } });
    renderProtected();
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await userEvent.click(within(codeDialog()).getByRole('button', { name: 'Use a recovery code' }));
    await userEvent.type(within(codeDialog()).getByLabelText('Recovery code'), 'abcde-fgh23');
    await userEvent.click(within(codeDialog()).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ recoveryCode: 'abcde-fgh23' });
  });

  it('Cancel gives up without running the action again', async () => {
    replies.push(needsCode);
    renderProtected();
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await userEvent.click(within(codeDialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('CANCELLED')).toBeInTheDocument());
    expect(calls()).toEqual(['POST /api/admin/thing']);
  });

  it('five wrong codes end the session: to the sign-in page', async () => {
    replies.push(needsCode, { status: 401, body: { error: 'x', errorCode: 'SESSION_ENDED', details: { message: 'Signed out.' } } });
    renderProtected();
    await userEvent.click(screen.getByRole('button', { name: 'Do it' }));
    await userEvent.type(within(codeDialog()).getByLabelText('Code from your authenticator app'), '000000');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
  });
});

describe('AuthenticatorsSection', () => {
  const app = (id: string, label: string) => ({ id, label, createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null });
  const renderApps = (apps: ReturnType<typeof app>[]) =>
    render(
      <SecondFactorProvider>
        <AuthenticatorsSection apps={apps} appName="Memoria" defaultLabel="Mac" />
      </SecondFactorProvider>,
    );

  it('the last app cannot be removed, and says why', () => {
    renderApps([app('a', 'iPhone')]);
    const remove = screen.getByRole('button', { name: 'Remove iPhone' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAccessibleDescription('You need at least one');
  });

  it('removing asks first, then removes and refreshes', async () => {
    replies.push({ status: 200, body: { data: { id: 'b' } } });
    renderApps([app('a', 'iPhone'), app('b', 'iPad')]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove iPad' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove iPad?' });
    expect(dialog).toHaveTextContent('devices signed in with it are signed out');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls()).toEqual(['DELETE /api/admin/authenticators/b']);
  });

  it('renames inline, limited to 60 characters', async () => {
    replies.push({ status: 200, body: { data: {} } });
    renderApps([app('a', 'iPhone')]);
    await userEvent.click(screen.getByRole('button', { name: 'Rename iPhone' }));
    const field = screen.getByLabelText('Name');
    expect(field).toHaveAttribute('maxlength', '60');
    await userEvent.clear(field);
    await userEvent.type(field, 'Work phone');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ label: 'Work phone' });
  });

  it('at 10 apps, Add is disabled with the reason', () => {
    renderApps(Array.from({ length: 10 }, (_, i) => app(String(i), `App ${i}`)));
    expect(screen.getByRole('button', { name: 'Add an app' })).toBeDisabled();
  });
});

describe('SessionsSection', () => {
  const session = (over: Partial<SessionItem>): SessionItem => ({
    id: 'x',
    device: 'Chrome on macOS',
    country: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    lastSeenAt: '2026-11-12T10:00:00.000Z',
    signedInWith: 'the app “iPhone”',
    current: false,
    ...over,
  });
  const renderSessions = (sessions: SessionItem[]) =>
    render(
      <SecondFactorProvider>
        <SessionsSection sessions={sessions} />
      </SecondFactorProvider>,
    );

  it('lists this device first, marked; no country when unknown', () => {
    renderSessions([session({ id: 'b', device: 'Safari on iPhone', country: 'BG' }), session({ id: 'a', current: true })]);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('This device');
    expect(rows[0]).not.toHaveTextContent('·signed');
    expect(rows[0]?.textContent).toMatch(/^Chrome on macOSThis devicesigned in/);
    expect(rows[1]).toHaveTextContent('Bulgaria · signed in');
  });

  it('with only this device: no "sign out all others", and says so', () => {
    renderSessions([session({ current: true })]);
    expect(screen.queryByRole('button', { name: 'Sign out all other devices' })).toBeNull();
    expect(screen.getByText('No other devices are signed in.')).toBeInTheDocument();
  });

  it('signing out this device goes to the sign-in page', async () => {
    renderSessions([session({ current: true })]);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out this device' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
  });
});

describe('pure helpers', () => {
  it.each([
    [{ total: 0, unused: 0, acknowledged: false }, null],
    [{ total: 10, unused: 10, acknowledged: true }, null],
    [{ total: 10, unused: 10, acknowledged: false }, 'Did you save your recovery codes? Without them, a lost phone locks you out.'],
    [{ total: 10, unused: 3, acknowledged: true }, 'Only 3 recovery codes are left. Generate new ones.'],
    [{ total: 10, unused: 1, acknowledged: true }, 'Only 1 recovery code is left. Generate new ones.'],
    [{ total: 10, unused: 0, acknowledged: true }, 'You have no recovery codes left. Generate new ones, or a lost phone locks you out.'],
  ])('banner %j', (status, expected) => {
    expect(recoveryBannerMessage(status)).toBe(expected);
  });

  it.each([
    [10, 'ink'],
    [4, 'ink'],
    [3, 'alert'],
    [0, 'danger'],
  ])('%i unused reads as %s', (unused, tone) => {
    expect(recoveryTone(unused)).toBe(tone);
  });
});
