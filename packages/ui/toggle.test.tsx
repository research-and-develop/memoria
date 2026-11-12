import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Toggle } from './toggle';

function Controlled({ initial = false, disabled = false }: { initial?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(initial);
  return <Toggle checked={checked} onCheckedChange={setChecked} label="Watermark" description="On every preview." disabled={disabled} />;
}

describe('Toggle', () => {
  it('is a switch named by its label and described by its description', () => {
    render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Watermark' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAccessibleDescription('On every preview.');
  });

  it('toggles on click and through its label', () => {
    render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Watermark' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Watermark'));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('uses the accent role when on and the input line when off', () => {
    render(<Controlled initial />);
    const toggle = screen.getByRole('switch', { name: 'Watermark' });
    expect(toggle.className).toContain('bg-accent');
    fireEvent.click(toggle);
    expect(toggle.className).toContain('bg-line-input');
  });

  it('does nothing while disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onCheckedChange={onChange} label="Watermark" disabled />);
    const toggle = screen.getByRole('switch', { name: 'Watermark' });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});
