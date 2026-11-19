import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TabPanel, Tabs, type TabItem } from './tabs';

const ITEMS: TabItem<string>[] = [
  { value: 'photos', label: 'Photos', count: 846 },
  { value: 'selections', label: 'Selections' },
  { value: 'store', label: 'Store', disabled: true },
  { value: 'settings', label: 'Settings' },
];

function Controlled({ initial = 'photos', variant, activation, onChange }: { initial?: string; variant?: 'line' | 'chip'; activation?: 'automatic' | 'manual'; onChange?: (v: string) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <Tabs
        id="sections"
        aria-label="Gallery sections"
        items={ITEMS}
        value={value}
        variant={variant}
        activation={activation}
        onValueChange={(v) => {
          onChange?.(v);
          setValue(v);
        }}
      />
      {ITEMS.map((item) => (
        <TabPanel key={item.value} id="sections" value={item.value} selected={item.value === value}>
          {item.value} panel
        </TabPanel>
      ))}
    </>
  );
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it.each(['line', 'chip'] as const)('%s: a labelled tablist with the value selected and its panel shown', (variant) => {
    render(<Controlled initial="selections" variant={variant} />);
    expect(screen.getByRole('tablist', { name: 'Gallery sections' })).toBeInTheDocument();
    expect(tab('Selections')).toHaveAttribute('aria-selected', 'true');
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('selections panel');
    expect(panel).toHaveAttribute('aria-labelledby', tab('Selections').id);
    expect(tab('Selections')).toHaveAttribute('aria-controls', panel.id);
  });

  it('has a roving tabindex: only the selected tab is tabbable', () => {
    render(<Controlled initial="selections" />);
    expect(tab('Selections')).toHaveAttribute('tabindex', '0');
    expect(tab(/Photos/)).toHaveAttribute('tabindex', '-1');
    expect(tab('Settings')).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click', () => {
    render(<Controlled />);
    fireEvent.click(tab('Settings'));
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('settings panel');
  });

  it.each(['line', 'chip'] as const)('%s: arrows move and select, skip disabled tabs and wrap; Home and End jump', (variant) => {
    render(<Controlled variant={variant} />);
    tab(/Photos/).focus();
    fireEvent.keyDown(tab(/Photos/), { key: 'ArrowRight' });
    expect(tab('Selections')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Selections')).toHaveFocus();
    fireEvent.keyDown(tab('Selections'), { key: 'ArrowRight' }); // Store is disabled
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('Settings'), { key: 'ArrowRight' }); // wraps
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab(/Photos/), { key: 'ArrowLeft' });
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('Settings'), { key: 'Home' });
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab(/Photos/), { key: 'End' });
    expect(tab('Settings')).toHaveAttribute('aria-selected', 'true');
  });

  it('manual activation: arrows move focus only; Enter (a click) selects', () => {
    const onChange = vi.fn();
    render(<Controlled activation="manual" onChange={onChange} />);
    fireEvent.keyDown(tab(/Photos/), { key: 'ArrowRight' });
    expect(tab('Selections')).toHaveFocus();
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'true');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(tab('Selections'));
    expect(onChange).toHaveBeenCalledWith('selections');
  });

  it('a disabled tab cannot be selected', () => {
    render(<Controlled />);
    expect(tab('Store')).toBeDisabled();
  });

  it('shows counts; the line variant underlines the selected tab in its text colour', () => {
    render(<Controlled />);
    expect(tab(/Photos/)).toHaveTextContent('Photos846');
    expect(tab(/Photos/).className).toContain('shadow-tab');
    expect(tab('Settings').className).not.toContain('shadow-tab');
  });

  it('ids are safe for values with spaces', () => {
    render(<Tabs id="sets" aria-label="Sets" items={[{ value: 'Getting ready', label: 'Getting ready' }]} value="Getting ready" onValueChange={() => undefined} />);
    expect(tab('Getting ready').id).toBe('sets-tab-Getting_ready');
  });
});
