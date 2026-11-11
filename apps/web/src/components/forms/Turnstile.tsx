'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { useAppConfig } from '@/components/AppProvider';

/**
 * Cloudflare Turnstile (managed mode) — the anti-bot check on public forms
 * (today the admin login). The script is loaded once, on first use, with
 * `render=explicit`; the widget hands its token to `onToken` and clears it
 * when it expires. The server verifies the token (src/lib/turnstile/verify.ts):
 * the widget alone protects nothing.
 *
 * `reset()` (via ref) asks for a new token after a failed submit — a token is
 * single-use.
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

export const Turnstile = forwardRef<
  TurnstileHandle,
  { action: 'login'; onToken: (token: string | null) => void; onError?: () => void; className?: string }
>(function Turnstile({ action, onToken, onError, className }, ref) {
  const { turnstileSiteKey } = useAppConfig();
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
          theme: 'light',
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
  }, [turnstileSiteKey, action]);

  return <div ref={containerRef} className={className} />;
});
