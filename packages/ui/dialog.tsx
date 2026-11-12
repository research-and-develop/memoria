'use client';

import * as React from 'react';

import { twMerge } from './cn';

/**
 * A dialog on the native `<dialog>` element, opened with `showModal()`: the browser traps focus,
 * makes the page inert and closes on Esc. This adds what it does not do: a click on the backdrop
 * closes, the page behind does not scroll, and focus returns to what had it before.
 *
 *   <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="title">…</Dialog>
 *
 * `variant`: `modal` (centred panel) or `drawer` (full-height panel from the left). The first focus
 * goes to an element with `autoFocus` inside, else to the dialog's first focusable element.
 */
export type DialogVariant = 'modal' | 'drawer';

const VARIANT: Record<DialogVariant, { dialog: string; content: string }> = {
  modal: { dialog: 'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-panel', content: 'p-6' },
  drawer: { dialog: 'm-0 mr-auto h-full max-h-full w-drawer max-w-[85vw] motion-safe:animate-drawer-in', content: 'h-full' },
};

export type DialogProps = Omit<React.DialogHTMLAttributes<HTMLDialogElement>, 'open'> & {
  open: boolean;
  onClose: () => void;
  variant?: DialogVariant;
};

export const Dialog = React.forwardRef<HTMLDialogElement, DialogProps>(
  ({ open, onClose, variant = 'modal', className, children, onClick, ...rest }, forwardedRef) => {
    const ref = React.useRef<HTMLDialogElement | null>(null);
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;
    /** Set while WE close it (the prop went false): that close is not news to the owner. */
    const closingRef = React.useRef(false);

    const setRef = (node: HTMLDialogElement | null) => {
      ref.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };

    // Open and close with the prop; while open, lock the page's scroll and remember the focus.
    React.useEffect(() => {
      const dialog = ref.current;
      if (!dialog || !open) return;
      const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const root = document.documentElement;
      const overflow = root.style.overflow;
      root.style.overflow = 'hidden';
      if (!dialog.open) dialog.showModal();
      return () => {
        root.style.overflow = overflow;
        if (dialog.open) {
          closingRef.current = true;
          dialog.close();
          closingRef.current = false;
        }
        returnTo?.focus();
      };
    }, [open]);

    // Esc (and any other close) tells the owner, who sets `open` to false.
    React.useEffect(() => {
      const dialog = ref.current;
      if (!dialog) return;
      const handle = () => {
        if (!closingRef.current) onCloseRef.current();
      };
      dialog.addEventListener('close', handle);
      return () => dialog.removeEventListener('close', handle);
    }, []);

    return (
      <dialog
        ref={setRef}
        className={twMerge(
          'bg-surface p-0 text-ink backdrop:bg-ink/40 motion-safe:backdrop:animate-fade-in',
          VARIANT[variant].dialog,
          className,
        )}
        onClick={(e) => {
          onClick?.(e);
          // The content fills the dialog, so a click on the dialog element itself is on the backdrop.
          if (e.target === e.currentTarget) onCloseRef.current();
        }}
        {...rest}
      >
        <div className={VARIANT[variant].content}>{children}</div>
      </dialog>
    );
  },
);
Dialog.displayName = 'Dialog';
