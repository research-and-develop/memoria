'use client';

import { useEffect, useState } from 'react';

import { Button } from '@repo/ui/button';
import { Checkbox } from '@repo/ui/input';
import { Text } from '@repo/ui/typography';

import { FormNote, StepHeading } from './StepHeading';

/** `memoria-recovery-codes-2026-11-12.txt` */
export function recoveryCodesFileName(now = new Date()): string {
  return `memoria-recovery-codes-${now.toISOString().slice(0, 10)}.txt`;
}

export function recoveryCodesText(codes: readonly string[], appName: string): string {
  return [`${appName} recovery codes`, 'Each code signs in once, instead of a code from your phone.', '', ...codes, ''].join('\n');
}

/**
 * The 10 recovery codes, shown once: copy, download, and "I have saved these
 * codes" before Continue. Leaving the page before ticking it asks first.
 */
export function RecoveryCodesPanel({
  codes,
  appName,
  continueLabel = 'Continue',
  onContinue,
}: {
  codes: readonly string[];
  appName: string;
  continueLabel?: string;
  onContinue: () => Promise<void> | void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (saved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  const text = recoveryCodesText(codes, appName);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setNote(null);
    } catch {
      setNote('Copying is blocked here. Select the codes and copy them, or download them.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = recoveryCodesFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-5">
      <StepHeading>Save your recovery codes</StepHeading>
      <Text as="p" size="body-sm" tone="ink2">
        Each code signs you in once if you do not have your phone. Shown once. Without these codes and without your phone, only the developer
        can get you back in.
      </Text>
      <ol aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-control border border-line bg-wash px-4 py-3 font-mono text-body text-ink select-all">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <FormNote message={note} tone="info" />
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" onClick={download}>
          Download
        </Button>
      </div>
      <Checkbox label="I have saved these codes" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <div className="flex flex-col gap-2">
        <Button
          variant="dark"
          className="w-full"
          disabled={!saved}
          loading={busy}
          aria-describedby={saved ? undefined : 'recovery-codes-continue-reason'}
          onClick={async () => {
            setBusy(true);
            try {
              await onContinue();
            } finally {
              setBusy(false);
            }
          }}
        >
          {continueLabel}
        </Button>
        {saved ? null : (
          <Text as="p" id="recovery-codes-continue-reason" size="caption" tone="muted">
            Tick “I have saved these codes” to continue.
          </Text>
        )}
      </div>
    </div>
  );
}
