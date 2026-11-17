import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Watermark } from '@/lib/settings/parseWatermarkInput';

import { WatermarksSection } from './WatermarksSection';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin/settings/watermarks' }));
const put = vi.hoisted(() => vi.fn());
vi.mock('@/lib/images/upload', () => ({ putToSignedUrl: put }));
vi.mock('@/lib/images/imageSize', () => ({ readImageSize: async () => ({ w: 800, h: 200 }) }));

type Reply = { status: number; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${String(c[0])}`);
const lastBody = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body)) as Record<string, unknown>;

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift() ?? { status: 200, body: { data: {} } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 200, close: () => {} }));
  put.mockReset();
  router.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const NONE: Watermark = { kind: 'none' };
const KEY = 'branding/watermarks/0b6f4a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png';
const renderSection = (props: { initial?: Watermark; imageUrl?: string | null; canUseImage?: boolean } = {}) =>
  render(<WatermarksSection initial={props.initial ?? NONE} imageUrl={props.imageUrl ?? null} canUseImage={props.canUseImage ?? true} />);
const kind = (name: 'None' | 'Image' | 'Text') => userEvent.click(screen.getByRole('radio', { name }));
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const png = () => new File([new Uint8Array(1000)], 'signature.png', { type: 'image/png' });

describe('Settings → Watermarks', () => {
  it('the kind switch shows the fields of each kind', async () => {
    renderSection();
    expect(screen.queryByLabelText('Text')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Position' })).toBeNull();
    await kind('Text');
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Ink' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Position' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /Top left|Centre|Bottom right|Tiled/ })).toHaveLength(4);
    await kind('Image');
    expect(screen.getByLabelText('Image')).toBeInTheDocument();
    expect(screen.queryByLabelText('Text')).toBeNull();
  });

  it('a text watermark is saved with its placement', async () => {
    renderSection();
    await kind('Text');
    expect(saveButton()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Text'), '© Northlight');
    await userEvent.click(screen.getByRole('radio', { name: 'Tiled' }));
    replies.push({ status: 200, body: { data: { watermark: { kind: 'text' }, imageUrl: null } } });
    await userEvent.click(saveButton());
    expect(calls().at(-1)).toBe('PATCH /api/admin/settings/watermark');
    expect(lastBody()).toEqual({ kind: 'text', text: '© Northlight', font: 'sans', ink: 'light', position: 'tiled', size: 20, opacity: 60, margin: 3 });
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('an image: Save is disabled until it is uploaded; mint → PUT → ready', async () => {
    renderSection();
    await kind('Image');
    expect(saveButton()).toBeDisabled();
    const upload = { url: '/api/blobs/upload?t=x', method: 'PUT', headers: { 'content-type': 'image/png' } };
    replies.push({ status: 200, body: { data: { key: KEY, upload } } });
    put.mockResolvedValueOnce(undefined);
    await userEvent.upload(screen.getByLabelText('Image'), png());
    expect(await screen.findByText('Uploaded. Save to use it.')).toBeInTheDocument();
    expect(calls()).toEqual(['POST /api/admin/settings/watermark/upload']);
    expect(lastBody()).toEqual({ contentType: 'image/png', size: 1000 });
    expect(put).toHaveBeenCalledWith(expect.any(File), upload, expect.anything());
    expect(saveButton()).toBeEnabled();
    replies.push({ status: 200, body: { data: { watermark: { kind: 'image' }, imageUrl: null } } });
    await userEvent.click(saveButton());
    expect(lastBody()).toMatchObject({ kind: 'image', key: KEY, width: 800, height: 200, contentType: 'image/png' });
  });

  it('a failed upload says so and keeps Save disabled', async () => {
    renderSection();
    await kind('Image');
    replies.push({ status: 200, body: { data: { key: KEY, upload: { url: '/u', method: 'PUT', headers: {} } } } });
    put.mockRejectedValueOnce(new Error('network'));
    await userEvent.upload(screen.getByLabelText('Image'), png());
    expect(await screen.findByText(/The upload failed/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('a file of another type is refused before anything is minted', async () => {
    renderSection();
    await kind('Image');
    await userEvent.upload(screen.getByLabelText('Image'), new File(['x'], 'photo.jpg', { type: 'image/jpeg' }), { applyAccept: false });
    expect(await screen.findByText(/Choose a PNG or WebP/)).toBeInTheDocument();
    expect(calls()).toEqual([]);
  });

  it('without the public media domain: the line says why and the picker is disabled', async () => {
    renderSection({ canUseImage: false });
    await kind('Image');
    expect(screen.getByText(/needs the public media domain/)).toBeInTheDocument();
    expect(screen.getByLabelText('Image')).toBeDisabled();
  });

  it('a saved image watermark starts ready to save again (its placement can change)', async () => {
    const initial: Watermark = { kind: 'image', key: KEY, width: 800, height: 200, contentType: 'image/png', position: 'center', size: 30, opacity: 50, margin: 0 };
    renderSection({ initial, imageUrl: null });
    expect(screen.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Centre' })).toBeChecked();
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it('a server field error is shown under its field', async () => {
    renderSection();
    await kind('Text');
    await userEvent.type(screen.getByLabelText('Text'), 'x');
    replies.push({ status: 400, body: { error: 'Invalid parameters', errorCode: 'INVALID_PARAMS', details: { field: 'text', message: 'Enter the watermark text.' } } });
    await userEvent.click(saveButton());
    expect(await screen.findByText('Enter the watermark text.')).toBeInTheDocument();
  });
});
