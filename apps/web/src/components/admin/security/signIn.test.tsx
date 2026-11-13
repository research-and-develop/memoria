import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { takeLoginNote } from '../login/loginFlash';
import { SecondFactorProvider } from './SecondFactor';
import { PASSWORD_CHANGED_NOTE, SignInSection, type SignInAccount } from './SignInSection';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/settings/security' }));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0])}`);
const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)) as Record<string, unknown>;
const needsCode: Reply = { status: 403, body: { error: 'x', errorCode: 'SECOND_FACTOR_REQUIRED', details: { message: 'Enter a code.' } } };

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
afterEach(() => {
  vi.unstubAllGlobals();
  takeLoginNote();
});

const ACCOUNT: SignInAccount = { email: 'owner@example.com', installerPassword: false, envPasswordStillSet: false };
const renderCard = (account: Partial<SignInAccount> = {}) =>
  render(
    <SecondFactorProvider>
      <SignInSection account={{ ...ACCOUNT, ...account }} />
    </SecondFactorProvider>,
  );

describe('Your sign-in', () => {
  it('shows the email; the notes only when they apply', () => {
    const { unmount } = renderCard();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/set when the site was installed/)).toBeNull();
    expect(screen.queryByText(/ADMIN_PASSWORD_HASH/)).toBeNull();
    unmount();
    renderCard({ installerPassword: true, envPasswordStillSet: true });
    expect(screen.getByText(/set when the site was installed/)).toBeInTheDocument();
    expect(screen.getByText(/ADMIN_PASSWORD_HASH/)).toBeInTheDocument();
  });

  it('changes the email: asks for a code, retries once, refreshes', async () => {
    replies.push(needsCode, { status: 200, body: { data: { verifiedUntil: 'x' } } }, { status: 200, body: { data: { email: 'new@example.com' } } });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await userEvent.type(screen.getByLabelText('New email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Current password'), 'my-password-123');
    await userEvent.click(within(screen.getByRole('region', { name: 'Your sign-in' })).getAllByRole('button', { name: 'Change email' })[1]!);
    await userEvent.type(within(screen.getByRole('dialog', { name: 'Confirm it is you' })).getByLabelText('Code from your authenticator app'), '123456');
    await waitFor(() => expect(screen.getByText(/Email changed/)).toBeInTheDocument());
    expect(calls()).toEqual(['PATCH /api/admin/account/email', 'POST /api/admin/second-factor', 'PATCH /api/admin/account/email']);
    expect(bodyOf(2)).toEqual({ email: 'new@example.com', currentPassword: 'my-password-123' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a wrong current password shows on its field', async () => {
    replies.push({ status: 400, body: { error: 'x', errorCode: 'WRONG_PASSWORD', details: { message: 'That is not your current password.', field: 'currentPassword' } } });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await userEvent.type(screen.getByLabelText('New email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-password');
    await userEvent.click(within(screen.getByRole('region', { name: 'Your sign-in' })).getAllByRole('button', { name: 'Change email' })[1]!);
    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('checks the new password before sending: length and the repeat', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.type(screen.getByLabelText('Current password'), 'my-password-123');
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    const submit = () => userEvent.click(within(screen.getByRole('region', { name: 'Your sign-in' })).getAllByRole('button', { name: 'Change password' })[1]!);
    await submit();
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a-long-new-password');
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'a-long-new-passwore');
    await submit();
    expect(screen.getByText('The two new passwords are not the same.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Generate fills both fields, shows the password and copies it', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate a password' }));
    const generated = (screen.getByLabelText('New password') as HTMLInputElement).value;
    expect(generated).toMatch(/^[A-Za-z0-9]{6}(-[A-Za-z0-9]{6}){3}$/);
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Repeat the new password')).toHaveValue(generated);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(generated);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('after a password change: to the sign-in page with a note', async () => {
    replies.push({ status: 200, body: { data: { signedOut: true } } });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.type(screen.getByLabelText('Current password'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Generate a password' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Your sign-in' })).getAllByRole('button', { name: 'Change password' })[1]!);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
    expect(takeLoginNote()).toBe(PASSWORD_CHANGED_NOTE);
  });

  it('a session ended by wrong passwords goes to the sign-in page', async () => {
    replies.push({ status: 401, body: { error: 'x', errorCode: 'SESSION_ENDED', details: { message: 'Signed out.' } } });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await userEvent.type(screen.getByLabelText('New email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-password');
    await userEvent.click(within(screen.getByRole('region', { name: 'Your sign-in' })).getAllByRole('button', { name: 'Change email' })[1]!);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
  });
});
