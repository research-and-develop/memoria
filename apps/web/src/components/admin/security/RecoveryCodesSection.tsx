'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { useApi } from '@repo/ui/hooks/useApi';
import { Heading, Text } from '@repo/ui/typography';

import { RecoveryCodesPanel } from '@/components/admin/login/RecoveryCodesPanel';

import { ConfirmDialog } from './ConfirmDialog';
import { isSignedOut, useConfirmThen } from './SecondFactor';
import { SecuritySection } from './SecuritySection';

export type RecoveryStatus = { total: number; unused: number; acknowledged: boolean };

/** How the unused count reads: fine, low (≤ 3) or none left. */
export function recoveryTone(unused: number): 'ink' | 'alert' | 'danger' {
  if (unused === 0) return 'danger';
  return unused <= 3 ? 'alert' : 'ink';
}

/** Settings → Security → Recovery codes: how many are left; new codes (confirmed with a code), shown once. */
export function RecoveryCodesSection({ status, appName }: { status: RecoveryStatus; appName: string }) {
  const router = useRouter();
  const confirmThen = useConfirmThen();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const regenerate = useApi<{ recoveryCodes: string[] }>('/api/admin/recovery-codes', { method: 'POST' });
  const acknowledge = useApi('/api/admin/recovery-codes/acknowledge', { method: 'POST' });

  const onGenerate = async () => {
    setError(null);
    const result = await confirmThen(() => regenerate.execute({}));
    if (isSignedOut(result)) return router.replace('/admin/login');
    if (result.error) {
      if (result.error.errorCode !== 'CANCELLED') {
        setError(typeof result.error.details?.message === 'string' ? result.error.details.message : 'Could not make new codes. Please try again.');
      }
      return;
    }
    setAsking(false);
    setCodes(result.data?.recoveryCodes ?? []);
  };

  const tone = recoveryTone(status.unused);
  return (
    <SecuritySection
      id="recovery-codes"
      title="Recovery codes"
      description="Each one signs you in once, instead of a code from your phone."
      action={
        <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
          Generate new codes
        </Button>
      }
    >
      <Text as="p" weight="semibold" tone={tone}>
        {status.unused} of {status.total} unused
        {tone === 'danger' ? ': generate new codes now.' : tone === 'alert' ? ': running low, generate new codes.' : ''}
      </Text>
      <ConfirmDialog
        open={asking}
        title="Generate new recovery codes?"
        body={status.unused > 0 ? `Your ${status.unused} unused ${status.unused === 1 ? 'code stops' : 'codes stop'} working.` : 'You will get 10 new codes.'}
        confirmLabel="Generate"
        busy={regenerate.loading}
        error={error}
        onConfirm={onGenerate}
        onCancel={() => {
          setAsking(false);
          setError(null);
        }}
      />
      {codes ? (
        // Shown once: Esc and the backdrop do not close it, only Done (after "I have saved these codes").
        <Dialog
          open
          onClose={() => undefined}
          onCancel={(e) => e.preventDefault()}
          aria-labelledby="new-recovery-codes-title"
          className="max-w-lg"
        >
          <div className="flex flex-col gap-4">
            <Heading level={2} size="title" id="new-recovery-codes-title">
              Your new recovery codes
            </Heading>
            <RecoveryCodesPanel
              codes={codes}
              appName={appName}
              withHeading={false}
              continueLabel="Done"
              onContinue={async () => {
                await acknowledge.execute({});
                setCodes(null);
                router.refresh();
              }}
            />
          </div>
        </Dialog>
      ) : null}
    </SecuritySection>
  );
}
