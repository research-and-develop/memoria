import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '@/components/AppProvider';

import { ContactForm } from './ContactForm';

// The widget is the edge: hand the form a token at once.
vi.mock('@/components/forms/Turnstile', async () => {
  const { forwardRef, useEffect } = await import('react');
  return {
    Turnstile: forwardRef<unknown, { onToken: (t: string) => void }>(function Turnstile({ onToken }, _ref) {
      useEffect(() => onToken('test-token'), [onToken]);
      return null;
    }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm() {
  return render(
    <AppProvider config={{ appName: 'Test', turnstileSiteKey: 'key' }}>
      <ContactForm />
    </AppProvider>,
  );
}

async function fillValid() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), 'ada@example.com');
  await user.type(screen.getByLabelText('Message'), 'Hello!');
  await user.click(screen.getByLabelText(/I agree/));
  return user;
}

describe('ContactForm', () => {
  it('shows the parser’s errors without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Please enter your email.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the message with the Turnstile token and thanks the visitor', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'x' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thank you'));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/contact');
    expect(JSON.parse(String(init.body))).toMatchObject({ name: 'Ada Lovelace', consent: true, turnstileToken: 'test-token', website: '' });
  });

  it('shows the server’s field error from the envelope', async () => {
    const envelope = { error: 'Invalid parameters', errorCode: 'INVALID_PARAMS', details: { field: 'email', message: 'Please enter a valid email.' } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(envelope), { status: 400 })));
    renderForm();
    const user = await fillValid();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Please enter a valid email.')).toBeInTheDocument());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
