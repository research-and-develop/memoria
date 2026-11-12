import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './dialog';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        aria-label="Example"
      >
        <button onClick={() => setOpen(false)}>Done</button>
      </Dialog>
    </>
  );
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;

describe('Dialog', () => {
  it('opens with the prop, locks the page scroll, and on close restores it and returns focus', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(dialog()).toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dialog()).not.toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('a click on the backdrop closes it; a click inside does not', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(dialog().firstElementChild as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toHaveAttribute('open');
  });

  it('a close from the browser (Esc) tells the owner', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    dialog().close();
    expect(onClose).toHaveBeenCalled();
    expect(dialog()).not.toHaveAttribute('open');
  });
});
