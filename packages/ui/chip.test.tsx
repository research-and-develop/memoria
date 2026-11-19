import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Chip } from './chip';

describe('Chip', () => {
  it('is a toggle button that reports its state', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Chip selected={false} onClick={onClick}>
        Ceremony
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Ceremony' });
    expect(chip).toHaveAttribute('type', 'button');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Chip selected onClick={onClick}>
        Ceremony
      </Chip>,
    );
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('selected = an accent fill with inverse text; unselected = a surface pill with a 1.5 px border', () => {
    render(
      <>
        <Chip selected>On</Chip>
        <Chip selected={false}>Off</Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'On' }).className).toMatch(/\bbg-accent\b.*\btext-inverse\b|\btext-inverse\b.*\bbg-accent\b/);
    const off = screen.getByRole('button', { name: 'Off' });
    expect(off.className).toContain('bg-surface');
    expect(off.className).toContain('border-chip');
    expect(off.className).not.toContain('bg-ink');
  });

  it('has a 44 px hit area on a coarse pointer', () => {
    render(<Chip selected={false}>Touch</Chip>);
    expect(screen.getByRole('button').className).toContain("coarse:before:content-['']");
  });

  it('shows a count after the label', () => {
    render(
      <Chip selected={false} count={210}>
        Ceremony
      </Chip>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Ceremony210');
  });

  it("as a tab it reports aria-selected, not aria-pressed", () => {
    render(
      <Chip selected role="tab">
        Party
      </Chip>,
    );
    const tab = screen.getByRole('tab', { name: 'Party' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).not.toHaveAttribute('aria-pressed');
  });

  it('forwards its ref and merges a className', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Chip ref={ref} selected={false} className="px-5">
        Ref
      </Chip>,
    );
    expect(ref.current).toBe(screen.getByRole('button'));
    expect(ref.current?.className).toContain('px-5');
    expect(ref.current?.className).not.toContain('px-3.5');
  });
});
