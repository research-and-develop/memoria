import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteGalleryCard } from './DeleteGalleryCard';
import { GalleryManager } from './GalleryManager';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/galleries/g1' }));

type Reply = { status: number; body: unknown };
let routes: Record<string, Reply[]>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0]).split('?')[0]}`);
const bodyOf = (method: string, path: string) => {
  const call = fetchMock.mock.calls.find((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method && String(c[0]).startsWith(path));
  return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
};

const G = 'g1';
const SETS = [
  { id: 's1', name: 'Photos', photoCount: 2 },
  { id: 's2', name: 'Ceremony', photoCount: 0 },
];
const PHOTOS = [
  { id: 'p1', filename: 'IMG_1.jpg', width: 3, height: 2, color: '#777777', hidden: false, status: 'ready', thumbUrl: '/t/1' },
  { id: 'p2', filename: 'IMG_2.jpg', width: 3, height: 2, color: '#777777', hidden: true, status: 'ready', thumbUrl: '/t/2' },
];
const UPLOAD = { processing: { display: { longEdge: 2048, quality: 82 }, thumb: { longEdge: 600, quality: 78 } }, watermark: null, imageUrl: null };
const GALLERY = { cover_photo_id: 'p1', settings: { sort: 'filename' }, sets: SETS, ...UPLOAD, unfinishedUploads: 0 };

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    const queued = routes[key]?.shift();
    if (queued) return new Response(JSON.stringify(queued.body), { status: queued.status });
    if (key === `GET /api/admin/galleries/${G}/photos`) return new Response(JSON.stringify({ data: PHOTOS, next: null }));
    if (key === `GET /api/admin/galleries/${G}`) return new Response(JSON.stringify({ data: GALLERY }));
    return new Response(JSON.stringify({ data: {} }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const renderManager = (unfinishedUploads = 0) =>
  render(<GalleryManager title="Maria & Jonas" initial={{ id: G, coverPhotoId: 'p1', sort: 'filename', sets: SETS, upload: UPLOAD, unfinishedUploads }} />);

describe('DeleteGalleryCard', () => {
  it('asks for the title before deleting, then goes back to the galleries', async () => {
    render(<DeleteGalleryCard galleryId={G} title="Maria & Jonas" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete gallery' }));
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Gallery title'), 'Maria & Jo');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Gallery title'), 'nas');
    await userEvent.click(confirm);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/galleries'));
    expect(calls()).toContain(`DELETE /api/admin/galleries/${G}`);
  });
});

describe('GalleryManager', () => {
  it('the uploader sits above the grid and uploads into the current set', async () => {
    const user = userEvent.setup();
    renderManager();
    expect(screen.getByRole('region', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByText('Loose photos go into “Photos”; photos in a folder go into the set named after it.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Ceremony/ }));
    expect(screen.getByText('Loose photos go into “Ceremony”; photos in a folder go into the set named after it.')).toBeInTheDocument();
  });

  it('the unfinished-uploads banner follows the server: shown from the page, gone after a reload says 0', async () => {
    const user = userEvent.setup();
    renderManager(4);
    expect(screen.getByRole('status')).toHaveTextContent('4 photos did not finish uploading.');
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    await user.click(screen.getByRole('radio', { name: 'Capture time' }));
    await waitFor(() => expect(calls()).toContain(`GET /api/admin/galleries/${G}`));
    await user.click(screen.getByRole('tab', { name: 'Photos' }));
    await waitFor(() => expect(screen.queryByText(/did not finish uploading/)).not.toBeInTheDocument());
  });

  it('shows the first set with Cover and Hidden badges; selecting a photo opens the bulk bar', async () => {
    renderManager();
    const first = await screen.findByRole('checkbox', { name: 'Select IMG_1.jpg' });
    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).toBeNull();
    await userEvent.click(first);
    const bar = screen.getByRole('toolbar', { name: 'Selected photos' });
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(calls()).toContain(`POST /api/admin/galleries/${G}/photos/bulk`));
    expect(bodyOf('POST', `/api/admin/galleries/${G}/photos/bulk`)).toEqual({ ids: ['p1'], action: 'hide' });
    // After the action the gallery is reloaded and the selection cleared.
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
    // Focus lands on the photos, not the page (the bar it was in is gone); the header refreshes.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Photos' })).toHaveFocus());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('delete asks first; move sends the target set', async () => {
    renderManager();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select IMG_2.jpg' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to set' }), 's2');
    // Choosing a set does nothing yet (on Windows ArrowDown on a closed select changes it).
    expect(calls()).not.toContain(`POST /api/admin/galleries/${G}/photos/bulk`);
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(bodyOf('POST', `/api/admin/galleries/${G}/photos/bulk`)).toEqual({ ids: ['p2'], action: 'move', setId: 's2' }));
  });

  it('reorders sets with the arrow buttons; the first cannot move up', async () => {
    renderManager();
    await userEvent.click(await screen.findByRole('button', { name: 'Move Ceremony up' }));
    await waitFor(() => expect(bodyOf('PUT', `/api/admin/galleries/${G}/sets/order`)).toEqual({ ids: ['s2', 's1'] }));
    expect(screen.getByRole('button', { name: 'Move Photos up' })).toBeDisabled();
    // Focus stays on the button that acted.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Ceremony up' })).toHaveFocus());
  });

  it('adds a set by name', async () => {
    routes[`POST /api/admin/galleries/${G}/sets`] = [{ status: 400, body: { error: 'x', errorCode: 'TOO_MANY_SETS', details: { message: 'A gallery can have up to 50 sets.' } } }];
    renderManager();
    await userEvent.click(await screen.findByRole('button', { name: '+ Add set' }));
    await userEvent.type(screen.getByLabelText('Set name'), 'Party');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('A gallery can have up to 50 sets.')).toBeInTheDocument();
    expect(bodyOf('POST', `/api/admin/galleries/${G}/sets`)).toEqual({ name: 'Party' });
  });
});
