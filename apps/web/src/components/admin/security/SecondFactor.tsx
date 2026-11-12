'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { Dialog } from '@repo/ui/dialog';
import { useApi, type ApiResult } from '@repo/ui/hooks/useApi';
import { Heading, Text } from '@repo/ui/typography';

import { cleanDigits, CodeField } from '@/components/admin/login/CodeField';
import { FormNote } from '@/components/admin/login/StepHeading';

/**
 * "Confirm with a code" on the client (D2.9). An action that answers 403
 * SECOND_FACTOR_REQUIRED opens the code dialog; once a code is accepted the
 * action runs again, once. Cancelling returns a CANCELLED result.
 *
 *   const confirmThen = useConfirmThen();
 *   const result = await confirmThen(() => execute(body));
 */
type Action<T> = () => Promise<ApiResult<T>>;
type ConfirmThen = <T>(action: Action<T>) => Promise<ApiResult<T>>;

const ConfirmContext = createContext<ConfirmThen | null>(null);

const CANCELLED = { data: null, error: { errorCode: 'CANCELLED', error: 'Cancelled' } };

export function useConfirmThen(): ConfirmThen {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('useConfirmThen needs a <SecondFactorProvider>');
  return value;
}

/** A refused request that means "this session is gone": back to the sign-in page. */
export function isSignedOut(result: ApiResult<unknown>): boolean {
  return result.error?.errorCode === 'UNAUTHORIZED' || result.error?.errorCode === 'SESSION_ENDED';
}

export function SecondFactorProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirmThen = useCallback<ConfirmThen>(async (action) => {
    const first = await action();
    if (first.error?.errorCode !== 'SECOND_FACTOR_REQUIRED') return first;
    const ok = await new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
    if (!ok) return CANCELLED;
    return action();
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirmThen}>
      {children}
      <CodeDialog open={open} onDone={finish} />
    </ConfirmContext.Provider>
  );
}

/** The dialog: a code from an authenticator app, or a recovery code. */
export function CodeDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const { execute, loading } = useApi<{ verifiedUntil: string }>('/api/admin/second-factor', { method: 'POST' });

  const reset = () => {
    setValue('');
    setError(null);
    setRecovery(false);
  };

  const close = (ok: boolean) => {
    reset();
    onDone(ok);
  };

  const submit = async (input: string) => {
    if (busy.current) return;
    if (!input.trim()) {
      setError(recovery ? 'Enter a recovery code.' : 'Enter the 6-digit code.');
      return;
    }
    busy.current = true;
    setError(null);
    const result = await execute(recovery ? { recoveryCode: input } : { code: input });
    busy.current = false;
    if (!result.error) return close(true);
    if (result.error.errorCode === 'ABORT_ERROR') return;
    if (isSignedOut(result)) {
      close(false);
      router.replace('/admin/login');
      router.refresh();
      return;
    }
    setError(typeof result.error.details?.message === 'string' ? result.error.details.message : 'That did not work. Please try again.');
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const onChange = (raw: string) => {
    if (recovery) return setValue(raw);
    const digits = cleanDigits(raw);
    setValue(digits);
    if (digits.length === 6 && digits !== value) void submit(digits);
  };

  return (
    <Dialog open={open} onClose={() => close(false)} aria-labelledby="confirm-code-title">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit(value);
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1">
          <Heading level={2} size="title" id="confirm-code-title">
            Confirm it is you
          </Heading>
          <Text as="p" size="body-sm" tone="muted">
            Enter a code to continue. You will not be asked again for 5 minutes.
          </Text>
        </div>
        <FormNote message={error} />
        <CodeField
          ref={inputRef}
          label={recovery ? 'Recovery code' : 'Code from your authenticator app'}
          value={value}
          onChange={onChange}
          digits={!recovery}
          autoFocus
        />
        <Button
          variant="link"
          className="min-h-11 self-start text-body-sm"
          onClick={() => {
            setRecovery((r) => !r);
            setValue('');
            setError(null);
            inputRef.current?.focus();
          }}
        >
          {recovery ? 'Use a code from your app' : 'Use a recovery code'}
        </Button>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={loading}>
            Confirm
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
