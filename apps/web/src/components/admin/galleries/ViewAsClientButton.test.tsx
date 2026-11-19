import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ViewAsClientButton } from './ViewAsClientButton';

const ID = '9a11e700-0000-4000-8000-000000000001';

function stubTab() {
  const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return tab;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ViewAsClientButton', () => {
  it('opens a tab on the click, then points it at the preview link', async () => {
    const tab = stubTab();
    const fetchSpy = vi.fn(async () => Response.json({ data: { url: '/g/maria?preview=1.x', expiresAt: '2026-11-19T11:00:00.000Z' } }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<ViewAsClientButton galleryId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'View as client' }));
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
    await vi.waitFor(() => expect(tab.location.href).toBe('/g/maria?preview=1.x'));
    expect(tab.opener).toBeNull();
    expect(String((fetchSpy.mock.calls[0] as unknown[] | undefined)?.[0])).toBe(`/api/admin/galleries/${ID}/preview-link`);
  });

  it("closes the tab and shows the server's message when the link cannot be made", async () => {
    const tab = stubTab();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'Gallery keys are not configured', errorCode: 'GALLERY_KEY_MISSING', details: { message: 'Previews need SETTINGS_ENCRYPTION_KEY.' } },
          { status: 503 },
        ),
      ),
    );
    render(<ViewAsClientButton galleryId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'View as client' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Previews need SETTINGS_ENCRYPTION_KEY.');
    expect(tab.close).toHaveBeenCalled();
  });
});
