import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecondFactorProvider } from '../security/SecondFactor';
import { StudioSection, type StudioFormProps } from './StudioSection';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/settings/studio' }));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0])}`);
const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)) as Record<string, unknown>;

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

const PROPS: StudioFormProps = { studio: { name: 'Memoria', siteUrl: null }, defaultSiteUrl: null, isDevelopment: false };
const renderForm = (props: Partial<StudioFormProps> = {}) =>
  render(
    <SecondFactorProvider>
      <StudioSection {...PROPS} {...props} />
    </SecondFactorProvider>,
  );
const address = () => screen.getByLabelText('Website address');
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('Settings → Studio', () => {
  it('shows a bare domain as it will be saved, with a link to check it', async () => {
    renderForm();
    expect(screen.queryByRole('link', { name: /Check it opens/ })).toBeNull();
    await userEvent.type(address(), 'Photos.Example.com');
    expect(screen.getByText('https://photos.example.com')).toBeInTheDocument();
    expect(screen.getByText('After saving')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Check it opens/ });
    expect(link).toHaveAttribute('href', 'https://photos.example.com/healthz');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('empty with SITE_URL set: names the address in use', () => {
    renderForm({ defaultSiteUrl: 'https://env.example.com', studio: { name: 'Memoria', siteUrl: 'https://env.example.com' } });
    // The field starts with the address in use; the hint names the fallback.
    expect(address()).toHaveValue('https://env.example.com');
    expect(screen.getByText(/Leave it empty to use https:\/\/env\.example\.com/)).toBeInTheDocument();
    expect(screen.getByText('In use')).toBeInTheDocument();
  });

  it('checks the fields before sending', async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText('Studio name'));
    await save();
    expect(screen.getByText('Enter the studio name.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Studio name'), 'North Light');
    await userEvent.type(address(), 'photos.example.com/weddings');
    await save();
    expect(screen.getByText(/without a page path/)).toBeInTheDocument();
    expect(address()).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a new address asks for a code, retries once, saves and refreshes', async () => {
    replies.push(
      { status: 403, body: { error: 'x', errorCode: 'SECOND_FACTOR_REQUIRED', details: { message: 'Enter a code.' } } },
      { status: 200, body: { data: { verifiedUntil: 'x' } } },
      { status: 200, body: { data: { name: 'Memoria', siteUrl: 'https://photos.example.com' } } },
    );
    renderForm();
    await userEvent.type(address(), 'photos.example.com');
    await save();
    await userEvent.type(within(screen.getByRole('dialog', { name: 'Confirm it is you' })).getByLabelText('Code from your authenticator app'), '123456');
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
    expect(calls()).toEqual(['PATCH /api/admin/settings/studio', 'POST /api/admin/second-factor', 'PATCH /api/admin/settings/studio']);
    expect(bodyOf(2)).toEqual({ name: 'Memoria', siteUrl: 'https://photos.example.com' });
    expect(address()).toHaveValue('https://photos.example.com');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a refusal shows on its field', async () => {
    replies.push({ status: 400, body: { error: 'x', errorCode: 'INVALID_PARAMS', details: { message: 'Keep the name shorter.', field: 'name' } } });
    renderForm();
    await save();
    expect(await screen.findByText('Keep the name shorter.')).toBeInTheDocument();
    expect(screen.getByLabelText('Studio name')).toHaveAttribute('aria-invalid', 'true');
  });
});
