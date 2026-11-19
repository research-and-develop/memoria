import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '@/components/AppProvider';

import { AdminTurnstile, Turnstile } from './Turnstile';

/** The widget's script is stubbed: `window.turnstile` exists, so no script is loaded. */
const renderWidget = vi.fn((_el: HTMLElement, _options: Record<string, unknown>) => 'widget-1');

beforeEach(() => {
  window.turnstile = { render: renderWidget, reset: vi.fn(), remove: vi.fn() };
});
afterEach(() => {
  renderWidget.mockClear();
  delete window.turnstile;
});

const optionsOfLastRender = () => renderWidget.mock.calls.at(-1)?.[1];

describe('Turnstile', () => {
  it('renders with the site key from its prop, without an AppProvider (the gallery gate)', async () => {
    render(<Turnstile siteKey="gallery-key" action="gallery-gate" theme="auto" onToken={() => {}} />);
    await vi.waitFor(() => expect(renderWidget).toHaveBeenCalled());
    expect(optionsOfLastRender()).toMatchObject({ sitekey: 'gallery-key', action: 'gallery-gate', theme: 'auto' });
  });

  it('renders nothing without a site key', async () => {
    render(<Turnstile siteKey="" action="gallery-gate" onToken={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(renderWidget).not.toHaveBeenCalled();
  });
});

describe('AdminTurnstile', () => {
  it("reads the AppProvider's site key", async () => {
    render(
      <AppProvider config={{ appName: 'Studio', turnstileSiteKey: 'admin-key' }}>
        <AdminTurnstile action="login" onToken={() => {}} />
      </AppProvider>,
    );
    await vi.waitFor(() => expect(renderWidget).toHaveBeenCalled());
    expect(optionsOfLastRender()).toMatchObject({ sitekey: 'admin-key', action: 'login', theme: 'light' });
  });
});
