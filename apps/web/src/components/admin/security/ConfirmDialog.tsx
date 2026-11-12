'use client';

import { useId } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { Heading, Text } from '@repo/ui/typography';

import { FormNote } from '@/components/admin/login/StepHeading';

/** "Remove iPhone?" — a question before a change that cannot be undone. Cancel gets the first focus. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <div className="flex flex-col gap-5">
        <Heading level={2} size="title" id={`${id}-title`}>
          {title}
        </Heading>
        <Text as="p" size="body-sm" tone="ink2" id={`${id}-body`}>
          {body}
        </Text>
        <FormNote message={error ?? null} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
