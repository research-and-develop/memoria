'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { useAppConfig } from '@/components/AppProvider';

export type TurnstileAction = 'login' | 'gallery-gate';
type TurnstileProps = {
  action: TurnstileAction;
  onToken: (token: string | null) => void;
  onError?: () => void;
  className?: string;
  /** The widget's colours when it shows (`auto` follows the system, for a gallery's auto theme). */
  theme?: 'light' | 'dark' | 'auto';
};

/**
 * Cloudflare Turnstile (managed mode) — the anti-bot check on public forms
 * (the admin login, the gallery password gate). The script is loaded once, on first use, with
 * `render=explicit`; the widget hands its token to `onToken` and clears it
 * when it expires. The server verifies the token (src/lib/turnstile/verify.ts):
 * the widget alone protects nothing.
 *
 * `reset()` (via ref) asks for a new token after a failed submit — a token is
 * single-use.
 *
 * Two components (plan p06 D6.4): `Turnstile` takes the site key as a PROP (the client gallery has no
 * `AppProvider`: its key comes in the view JSON); `AdminTurnstile` reads it from `AppProvider` (the
 * admin pages).
 */
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile_script_failed'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = { reset: () => void };

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps & { siteKey: string }>(function Turnstile(
  { siteKey: turnstileSiteKey, action, onToken, onError, className, theme = 'light' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Latest callbacks without re-rendering the widget.
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useImperativeHandle(ref, () => ({
    reset: () => {
      onTokenRef.current(null);
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    },
  }));

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: turnstileSiteKey,
          action,
          language: 'auto',
          theme,
          appearance: 'interaction-only',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null);
            onErrorRef.current?.();
          },
        });
      })
      .catch(() => onErrorRef.current?.());
    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [turnstileSiteKey, action, theme]);

  return <div ref={containerRef} className={className} />;
});

/** `Turnstile` with the site key from `AppProvider` (the admin pages). */
export const AdminTurnstile = forwardRef<TurnstileHandle, TurnstileProps>(function AdminTurnstile(props, ref) {
  const { turnstileSiteKey } = useAppConfig();
  return <Turnstile ref={ref} siteKey={turnstileSiteKey} {...props} />;
});
