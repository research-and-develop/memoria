import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BRANDING_DEFAULTS } from '@/lib/settings/parseBrandingInput';
import { GALLERY_DEFAULTS } from '@/lib/settings/parseGalleryDefaultsInput';

import { GalleriesList } from './GalleriesList';
import { NewGalleryForm } from './NewGalleryForm';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/galleries/new' }));
vi.mock('@/app/galleryFonts', () => ({ GALLERY_FONT_CLASSES: '' }));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const lastBody = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body)) as Record<string, unknown>;

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift() ?? { status: 200, body: { data: {} } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  router.push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const renderForm = (watermark: 'none' | 'text' = 'text') =>
  render(<NewGalleryForm defaults={GALLERY_DEFAULTS} branding={BRANDING_DEFAULTS} watermark={{ kind: watermark, label: 'Your text watermark' }} />);

describe('NewGalleryForm', () => {
  it('starts from the defaults and previews the address with the random part greyed', async () => {
    renderForm();
    expect(screen.getByRole('radio', { name: /Selection/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Watermark the previews' })).toBeChecked();
    await userEvent.type(screen.getByLabelText('Gallery name'), 'Мария и Иван');
    expect(screen.getByLabelText('Gallery address')).toHaveValue('mariya-i-ivan');
    expect(screen.getByText('/g/mariya-i-ivan')).toBeInTheDocument();
    expect(screen.getByText('-xxxxxxxxxx')).toBeInTheDocument();
  });

  it('switching to sharing turns the watermark off; without a studio watermark it cannot be turned on', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('radio', { name: /Sharing/ }));
    expect(screen.getByRole('switch', { name: 'Watermark the previews' })).not.toBeChecked();
    renderForm('none');
    expect(screen.getAllByRole('switch', { name: 'Watermark the previews' })[1]).toBeDisabled();
  });

  it('Generate fills a password; create sends the form and opens the gallery', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Gallery name'), 'Maria & Jonas');
    await userEvent.click(screen.getByRole('radio', { name: 'Password' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(String((screen.getByLabelText('Password') as HTMLInputElement).value)).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
    replies.push({ status: 201, body: { data: { id: 'g1', slug: 'maria-jonas-abcdefghij' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Create gallery' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/galleries/g1'));
    expect(lastBody()).toMatchObject({ title: 'Maria & Jonas', purpose: 'selection', access: 'password', watermark: true, display: GALLERY_DEFAULTS.display.selection });
  });

  it('shows a field error from the server next to its field', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText('Gallery name'), 'A');
    await userEvent.type(screen.getByLabelText('Client email'), 'nope');
    replies.push({ status: 400, body: { error: 'Invalid parameters', errorCode: 'INVALID_PARAMS', details: { field: 'clientEmail', message: 'Enter a valid email address.' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Create gallery' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('GalleriesList', () => {
  it('shows the empty state with a call to action', async () => {
    replies.push({ status: 200, body: { data: [], next: null } });
    render(<GalleriesList />);
    expect(await screen.findByText('No galleries yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New gallery' })[0]).toHaveAttribute('href', '/admin/galleries/new');
  });

  it('lists cards with their status and pages with Load more', async () => {
    const card = (id: string, title: string, status: 'draft' | 'published') => ({
      id,
      slug: `${id}-abcdefghij`,
      title,
      status,
      purpose: 'selection',
      photoCount: 3,
      shootDate: null,
      createdAt: '2026-11-19T10:00:00.000Z',
      deletedAt: null,
      coverUrl: null,
    });
    replies.push({ status: 200, body: { data: [card('a', 'First', 'published')], next: '2026-11-19T10:00:00.000Z|a' } });
    render(<GalleriesList />);
    expect(await screen.findByRole('link', { name: /First.*Live/ })).toHaveAttribute('href', '/admin/galleries/a');
    replies.push({ status: 200, body: { data: [card('b', 'Second', 'draft')], next: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: /Second.*Draft/ })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('cursor=');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('Deleted: a card shows when it goes for good; Restore takes it off the list', async () => {
    replies.push({ status: 200, body: { data: [], next: null } });
    render(<GalleriesList />);
    await screen.findByText('No galleries yet');
    const gone = {
      id: 'd1',
      slug: 'd1-abcdefghij',
      title: 'Old shoot',
      status: 'draft',
      purpose: 'sharing',
      photoCount: 2,
      shootDate: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      deletedAt: '2026-11-18T10:00:00.000Z',
      purgeAt: '2026-11-25T10:00:00.000Z',
      coverUrl: null,
    };
    replies.push({ status: 200, body: { data: [gone], next: null } });
    await userEvent.click(screen.getByRole('radio', { name: 'Deleted' }));
    expect(await screen.findByText(/Removed for good on/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Old shoot/ })).toBeNull();
    replies.push({ status: 200, body: { data: { id: 'd1' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByText('Old shoot')).toBeNull());
    const restoreCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/admin/galleries/d1/restore');
    expect((restoreCall![1] as RequestInit).method).toBe('POST');
  });
});
