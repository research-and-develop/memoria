import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharingPanel, type SharingGallery } from './SharingPanel';

const router = { refresh: vi.fn(), replace: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/galleries/g1' }));

type Reply = { status: number; body: unknown };
let routes: Record<string, Reply[]>;
let fetchMock: ReturnType<typeof vi.fn>;
const callsTo = (method: string, path: string) =>
  fetchMock.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method && String(c[0]).startsWith(path));
const bodyOf = (method: string, path: string) => JSON.parse(String((callsTo(method, path)[0]![1] as RequestInit).body)) as Record<string, unknown>;

const BASE: SharingGallery = {
  id: 'g1',
  slug: 'maria-jonas-abcdefghjk',
  published: true,
  access: 'password',
  clientName: 'Maria',
  clientEmail: 'maria@example.com',
  unfinished: 0,
};
const EMAIL = { id: 'j1', template: 'gallery.ready', templateLabel: 'Gallery ready', to: 'maria@example.com', status: 'queued', attempts: 0, maxAttempts: 6, lastError: null, createdAt: '', finishedAt: null, nextAttemptAt: null, canRetry: false };

beforeEach(() => {
  routes = {};
  router.refresh.mockReset();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    const queued = routes[key]?.shift();
    if (queued) return new Response(JSON.stringify(queued.body), { status: queued.status });
    if (key === 'GET /api/admin/galleries/g1/password') return new Response(JSON.stringify({ data: { password: 'maple-river-42' } }));
    if (key === 'GET /api/admin/galleries/g1/email-preview') return new Response(JSON.stringify({ data: { subject: 'Maria & Jonas — your photos are ready', html: '<p>Hi</p>', text: 'Hi' } }));
    if (key === 'POST /api/admin/galleries/g1/email') return new Response(JSON.stringify({ data: EMAIL }), { status: 202 });
    return new Response(JSON.stringify({ data: {} }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const renderPanel = (gallery: Partial<SharingGallery> = {}, siteUrl: string | null = 'https://photos.example.com') =>
  render(<SharingPanel gallery={{ ...BASE, ...gallery }} siteUrl={siteUrl} open onClose={() => {}} />);

describe('SharingPanel', () => {
  it('shows the link on the website address, its QR code, and the password', async () => {
    renderPanel();
    expect(screen.getByText('https://photos.example.com/g/maria-jonas-abcdefghjk')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /QR code for https:\/\/photos\.example\.com\/g\// })).toBeInTheDocument();
    expect(await screen.findByText('maple-river-42')).toBeInTheDocument();
  });

  it('New link asks first, then refreshes the page', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'New link' }));
    expect(screen.getByText(/The old link stops working at once/)).toBeInTheDocument();
    const dialogs = screen.getAllByRole('button', { name: 'New link' });
    await userEvent.click(dialogs[dialogs.length - 1]!);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(callsTo('POST', '/api/admin/galleries/g1/new-link')).toHaveLength(1);
  });

  it('changes the password with a generated one, and can remove it', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Change' }));
    const field = screen.getByLabelText('New password');
    expect((field as HTMLInputElement).value).toMatch(/^[a-z]+-[a-z]+-\d\d$/);
    await userEvent.clear(field);
    await userEvent.type(field, 'a-new-secret-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(bodyOf('PATCH', '/api/admin/galleries/g1')).toEqual({ access: 'password', password: 'a-new-secret-1' }));
    expect(await screen.findByText('a-new-secret-1')).toBeInTheDocument();
  });

  it('previews and sends the client email with the password', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Subject: Maria & Jonas — your photos are ready')).toBeInTheDocument();
    expect(String(callsTo('GET', '/api/admin/galleries/g1/email-preview')[0]![0])).toContain('include_password=1');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bodyOf('POST', '/api/admin/galleries/g1/email')).toEqual({ to: 'maria@example.com', name: 'Maria', includePassword: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Queued');
  });

  it('a draft or a studio without a website address cannot email yet', () => {
    const { unmount } = renderPanel({ published: false, unfinished: 3 });
    expect(screen.getByText('Publish the gallery first.')).toBeInTheDocument();
    expect(screen.getByText(/3 photos are still uploading/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    unmount();
    renderPanel({ access: 'link' }, null);
    expect(screen.getByRole('link', { name: 'Settings → Studio' })).toHaveAttribute('href', '/admin/settings/studio');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.queryByLabelText('Include the password')).toBeNull();
    expect(screen.getByText('Anyone with the link can open the gallery.')).toBeInTheDocument();
  });
});
