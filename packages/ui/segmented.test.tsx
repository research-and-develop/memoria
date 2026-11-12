import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Segmented } from './segmented';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
] as const;
type Mode = (typeof OPTIONS)[number]['value'];

function Controlled({ initial = 'light' }: { initial?: Mode }) {
  const [value, setValue] = React.useState<Mode>(initial);
  return <Segmented aria-label="Theme" options={OPTIONS} value={value} onValueChange={setValue} />;
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('Segmented', () => {
  it('is a labelled radio group with the value checked', () => {
    render(<Controlled initial="dark" />);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Light')).toHaveAttribute('aria-checked', 'false');
  });

  it('has a roving tabindex: only the selected option is tabbable', () => {
    render(<Controlled initial="dark" />);
    expect(radio('Dark')).toHaveAttribute('tabindex', '0');
    expect(radio('Light')).toHaveAttribute('tabindex', '-1');
    expect(radio('Auto')).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click', () => {
    render(<Controlled />);
    fireEvent.click(radio('Auto'));
    expect(radio('Auto')).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    ['ArrowRight', 'light', 'Dark'],
    ['ArrowDown', 'light', 'Dark'],
    ['ArrowLeft', 'dark', 'Light'],
    ['ArrowRight', 'auto', 'Light'],
    ['ArrowLeft', 'light', 'Auto'],
    ['Home', 'auto', 'Light'],
    ['End', 'light', 'Auto'],
  ] as const)('%s from %s moves to and selects %s', (key, initial, expected) => {
    render(<Controlled initial={initial} />);
    const start = screen.getByRole('radio', { checked: true });
    fireEvent.keyDown(start, { key });
    expect(radio(expected)).toHaveAttribute('aria-checked', 'true');
    expect(radio(expected)).toHaveFocus();
    expect(radio(expected)).toHaveAttribute('tabindex', '0');
  });

  it('marks the selected option with the raised surface role', () => {
    render(<Controlled />);
    expect(radio('Light').className).toContain('bg-surface');
    expect(radio('Dark').className).not.toContain('bg-surface');
  });
});
