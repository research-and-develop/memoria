import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeForm } from './CodeForm';
import { EnrollForm } from './EnrollForm';
import { safeNext, takeLoginNote } from './loginFlash';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { stepErrorOutcome } from './stepError';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The QR code loads through next/dynamic in the app; a stub keeps the test synchronous.
vi.mock('next/dynamic', () => ({
  default: () =>
    function QrStub({ label }: { label: string }) {
      return <svg role="img" aria-label={label} />;
    },
}));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift() ?? { status: 200, body: { data: {} } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  router.replace.mockReset();
  router.refresh.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)) as Record<string, unknown>;
const invalid = (attemptsLeft: number, message: string): Reply => ({
  status: 401,
  body: { error: message, errorCode: 'CODE_INVALID', details: { message, attemptsLeft } },
});

describe('CodeForm', () => {
  it('is a one-time-code field with a numeric keypad, never type=number', () => {
    render(<CodeForm />);
    const input = screen.getByLabelText('Code from your authenticator app');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
    expect(input).toHaveAttribute('maxlength', '7');
    expect(screen.getByRole('heading', { level: 1, name: 'Enter your code' })).toHaveFocus();
  });

  it.each(['123 456', '123-456', '123456'])('a pasted %j submits once, as 6 digits, then opens the studio', async (pasted) => {
    replies.push({ status: 200, body: { data: { expiresAt: 'x' } } });
    render(<CodeForm next="/admin/settings" />);
    fireEvent.change(screen.getByLabelText('Code from your authenticator app'), { target: { value: pasted } });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/settings'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ code: '123456' });
  });

  it('a wrong code keeps the value, focus and the attempts message', async () => {
    replies.push(invalid(4, 'That code did not work. 4 tries left.'));
    render(<CodeForm />);
    const input = screen.getByLabelText('Code from your authenticator app');
    await userEvent.type(input, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work. 4 tries left.');
    expect(input).toHaveValue('000000');
    expect(input).toHaveFocus();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('an expired sign-in goes back to the password with a note', async () => {
    replies.push({ status: 401, body: { error: 'expired', errorCode: 'CHALLENGE_EXPIRED', details: { message: 'This sign-in timed out. Enter your password again.' } } });
    render(<CodeForm />);
    fireEvent.change(screen.getByLabelText('Code from your authenticator app'), { target: { value: '111111' } });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(takeLoginNote()).toBe('This sign-in timed out. Enter your password again.');
  });

  it('the fifth wrong code also goes back to the password', async () => {
    replies.push(invalid(0, 'That code did not work. Enter your password again.'));
    render(<CodeForm />);
    fireEvent.change(screen.getByLabelText('Code from your authenticator app'), { target: { value: '111111' } });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('switches to a recovery code: free text, sent as recoveryCode on submit', async () => {
    replies.push({ status: 200, body: { data: { expiresAt: 'x', recoveryCodesLeft: 9 } } });
    render(<CodeForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    const input = screen.getByLabelText('Recovery code');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).not.toHaveAttribute('inputmode');
    await userEvent.type(input, 'ABCDE FGH23');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with recovery code' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin'));
    expect(sentBody()).toEqual({ recoveryCode: 'ABCDE FGH23' });
  });

  it('Start over returns to step 1 even when the call fails', async () => {
    replies.push({ status: 500, body: { errorCode: 'X', error: 'x' } });
    render(<CodeForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });
});

describe('EnrollForm', () => {
  const props = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/Memoria:a%40b.c?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Memoria',
    defaultLabel: 'iPhone',
    appName: 'Memoria',
  };

  it('offers the QR code, a link for this phone and the key in groups of four', () => {
    render(<EnrollForm {...props} />);
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in authenticator app' })).toHaveAttribute('href', props.otpauthUri);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(screen.getByLabelText('Name of this app')).toHaveValue('iPhone');
  });

  it('copies the key, or selects it when copying is blocked', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('blocked');
    });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<EnrollForm {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(writeText).toHaveBeenCalledWith(props.secret);
    expect(window.getSelection()?.toString().replace(/\s/g, '')).toBe(props.secret);
  });

  it('a wrong code keeps the QR code, the key and the name', async () => {
    replies.push(invalid(3, 'That code did not work. 3 tries left.'));
    render(<EnrollForm {...props} />);
    await userEvent.clear(screen.getByLabelText('Name of this app'));
    await userEvent.type(screen.getByLabelText('Name of this app'), 'Work phone');
    await userEvent.type(screen.getByLabelText('Code from the app'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Connect and sign in' }));
    expect(await screen.findByText('That code did not work. 3 tries left.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Name of this app')).toHaveValue('Work phone');
    expect(sentBody()).toEqual({ code: '000000', label: 'Work phone' });
  });

  it('then shows the recovery codes; Continue acknowledges them and opens the studio', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `aaaa${'abcdefghij'[i]}-bbbbb`);
    replies.push({ status: 200, body: { data: { expiresAt: 'x', recoveryCodes: codes } } }, { status: 200, body: { data: { ok: true } } });
    render(<EnrollForm {...props} />);
    await userEvent.type(screen.getByLabelText('Code from the app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Connect and sign in' }));
    expect(await screen.findByRole('heading', { name: 'Save your recovery codes' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(screen.getByLabelText('I have saved these codes'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to the studio' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin'));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/recovery-codes/acknowledge');
  });
});

describe('RecoveryCodesPanel', () => {
  const codes = ['aaaaa-bbbbb', 'ccccc-ddddd'];

  it('keeps Continue disabled, with the reason, until the codes are saved', async () => {
    const onContinue = vi.fn();
    render(<RecoveryCodesPanel codes={codes} appName="Memoria" onContinue={onContinue} />);
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Tick “I have saved these codes” to continue.');
    await userEvent.click(screen.getByLabelText('I have saved these codes'));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onContinue).toHaveBeenCalled();
  });

  it('asks before the page is left while the codes are not saved', async () => {
    render(<RecoveryCodesPanel codes={codes} appName="Memoria" onContinue={() => {}} />);
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByLabelText('I have saved these codes'));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('copies all codes and downloads a dated text file', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RecoveryCodesPanel codes={codes} appName="Memoria" onContinue={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText.mock.calls[0]?.[0]).toContain('aaaaa-bbbbb\nccccc-ddddd');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    });
    expect(createObjectURL).toHaveBeenCalled();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^memoria-recovery-codes-\d{4}-\d{2}-\d{2}\.txt$/);
    click.mockRestore();
  });
});

describe('pure helpers', () => {
  it.each([
    [undefined, '/admin'],
    ['/admin/settings', '/admin/settings'],
    ['/admin?x=1', '/admin?x=1'],
    ['/administrator', '/admin'],
    ['//evil.example/admin', '/admin'],
    ['https://evil.example/admin', '/admin'],
  ])('safeNext(%j) → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    [{ errorCode: 'ABORT_ERROR', error: '' }, { kind: 'ignore' }],
    [{ errorCode: 'CODE_INVALID', error: '', details: { message: 'm', attemptsLeft: 2 } }, { kind: 'show', message: 'm' }],
    [{ errorCode: 'CODE_INVALID', error: '', details: { message: 'm', attemptsLeft: 0 } }, { kind: 'restart', note: 'm' }],
    [{ errorCode: 'ALREADY_ENROLLED', error: '', details: { message: 'm' } }, { kind: 'restart', note: 'm' }],
    [{ errorCode: 'RATE_LIMITED', error: '' }, { kind: 'show', message: 'Something went wrong. Please try again.' }],
  ])('stepErrorOutcome %#', (error, expected) => {
    expect(stepErrorOutcome(error)).toEqual(expected);
  });
});
