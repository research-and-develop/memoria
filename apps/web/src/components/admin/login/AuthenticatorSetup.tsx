'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

import { Button } from '@repo/ui/button';
import { Mono, Text } from '@repo/ui/typography';

import { groupSecret } from '@/lib/auth/totp';

const QrCode = dynamic(() => import('./QrCode').then((m) => m.QrCode), {
  ssr: false,
  loading: () => <div className="h-[200px] w-[200px] shrink-0 rounded-control bg-wash" aria-hidden />,
});

/**
 * The three ways to put a secret into an authenticator app (D2.14): scan the QR code, tap
 * *Open in authenticator app* on the phone that shows this page, or type the key. Used by the
 * first sign-in and by Settings → Security.
 */
export function AuthenticatorSetup({ secret, otpauthUri, appName }: { secret: string; otpauthUri: string; appName: string }) {
  const [copied, setCopied] = useState(false);
  const secretRef = useRef<HTMLSpanElement>(null);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // Copying is blocked: select the key so the person can copy it.
      const range = document.createRange();
      if (secretRef.current) range.selectNodeContents(secretRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Text as="p" size="body-sm" tone="ink2">
        Use any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …). On this phone? Tap{' '}
        <strong className="font-semibold">Open in authenticator app</strong>. On a computer? Scan the code with your phone.
      </Text>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode value={otpauthUri} label={`QR code to add ${appName} to an authenticator app`} />
        <div className="flex w-full min-w-0 flex-col gap-3">
          <a href={otpauthUri} className="inline-flex min-h-11 items-center font-sans text-body-sm font-semibold text-accent-ink underline-offset-4 hover:underline">
            Open in authenticator app
          </a>
          <div className="flex flex-col gap-1">
            <Text size="caption" tone="muted">
              Or type this key into the app:
            </Text>
            <span ref={secretRef} className="break-all select-all">
              <Mono size="body-sm">{groupSecret(secret)}</Mono>
            </span>
            <Button variant="secondary" size="sm" className="self-start" onClick={copySecret}>
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
