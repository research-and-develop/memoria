import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { RadioCards } from './radioCards';
import { SwatchPicker } from './swatchPicker';

const PURPOSES = [
  { value: 'selection', label: 'Selection', description: 'Smaller watermarked previews.' },
  { value: 'sharing', label: 'Sharing', description: 'The final photos.' },
  { value: 'archive', label: 'Archive', disabled: true },
] as const;
type Purpose = (typeof PURPOSES)[number]['value'];

function Cards({ initial = 'selection' }: { initial?: Purpose }) {
  const [value, setValue] = React.useState<Purpose>(initial);
  return <RadioCards name="purpose" aria-label="Purpose" value={value} options={PURPOSES} onChange={setValue} />;
}

describe('RadioCards', () => {
  it('is a labelled group of native radios sharing a name (the browser moves with the arrow keys)', () => {
    render(<Cards />);
    expect(screen.getByRole('radiogroup', { name: 'Purpose' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toHaveAttribute('name', 'purpose');
    expect(screen.getByRole('radio', { name: 'Selection' })).toBeChecked();
  });

  it('reads the description with its option', () => {
    render(<Cards />);
    expect(screen.getByRole('radio', { name: 'Sharing' })).toHaveAccessibleDescription('The final photos.');
  });

  it('selects on click and on the keyboard (a change event)', () => {
    render(<Cards />);
    fireEvent.click(screen.getByText('Sharing'));
    expect(screen.getByRole('radio', { name: 'Sharing' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Selection' })).not.toBeChecked();
  });

  it('a disabled option cannot be picked', () => {
    render(<Cards />);
    expect(screen.getByRole('radio', { name: 'Archive' })).toBeDisabled();
  });
});

const SWATCHES = [
  { id: 'pine', label: 'Pine' },
  { id: 'navy', label: 'Navy' },
  { id: 'clay', label: 'Clay' },
] as const;
type Accent = (typeof SWATCHES)[number]['id'];

function Swatches({ theme }: { theme?: 'light' | 'dark' }) {
  const [value, setValue] = React.useState<Accent>('pine');
  return <SwatchPicker name="accent" aria-label="Accent" value={value} swatches={SWATCHES} onChange={setValue} theme={theme} />;
}

describe('SwatchPicker', () => {
  it('is a labelled radio group with a visible label per swatch', () => {
    render(<Swatches />);
    expect(screen.getByRole('radiogroup', { name: 'Accent' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('Navy')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Pine' })).toBeChecked();
  });

  it('selects on click', () => {
    render(<Swatches />);
    fireEvent.click(screen.getByText('Clay'));
    expect(screen.getByRole('radio', { name: 'Clay' })).toBeChecked();
  });

  it('paints each circle with the gallery attributes on one element, never an inline colour', () => {
    const { container } = render(<Swatches theme="dark" />);
    const circle = container.querySelector('[data-gallery-accent="navy"]');
    expect(circle).toHaveAttribute('data-gallery-theme', 'dark');
    expect(circle).toHaveClass('bg-accent');
    expect(container.querySelector('[style]')).toBeNull();
  });
});
