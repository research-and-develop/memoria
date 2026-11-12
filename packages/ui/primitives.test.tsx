import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonClassName } from './button';
import { twMerge } from './cn';
import { Checkbox, FormField, Input } from './input';
import { Pill, type PillTone } from './layout';
import { Heading, Text } from './typography';

describe('Button', () => {
  it('is a non-submitting button by default and calls onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled and busy while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Sending
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sending' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('hides the decorative arrow from screen readers', () => {
    render(<Button arrow>Next</Button>);
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('lets a caller override the size token (font sizes merge as sizes, not colours)', () => {
    const classes = buttonClassName({ variant: 'primary', className: 'text-body-lg' });
    expect(classes).toContain('text-body-lg');
    expect(classes).not.toMatch(/(?<![\w-])text-body(?![\w-])/);
    expect(twMerge('text-body text-ink-muted', 'text-heading')).toBe('text-ink-muted text-heading');
  });

  it.each([
    ['primary', 'bg-accent'],
    ['dark', 'bg-ink'],
    ['secondary', 'border-line-control'],
    ['danger', 'bg-danger'],
  ] as const)('the %s variant uses its theme role', (variant, role) => {
    expect(buttonClassName({ variant })).toContain(role);
  });

  it('names an icon-only button through aria-label', () => {
    render(
      <Button size="icon" aria-label="Close">
        ×
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it.each([
    ['sm', 'coarse:before:-inset-y-1'],
    ['md', 'coarse:before:-inset-y-0.5'],
    ['icon', 'coarse:before:-inset-0.5'],
  ] as const)('grows the %s hit area to 44 px on touch screens', (size, inset) => {
    const classes = buttonClassName({ size });
    expect(classes).toContain("coarse:before:content-['']");
    expect(classes).toContain(inset);
  });

  it('is fully rounded as a pill', () => {
    expect(buttonClassName({ pill: true })).toContain('rounded-full');
    expect(buttonClassName({ pill: true })).not.toContain('rounded-button');
  });
});

describe('Pill', () => {
  it.each<[PillTone, string]>([
    ['live', 'bg-live-bg text-live-fg'],
    ['proofing', 'bg-proofing-bg text-proofing-fg'],
    ['draft', 'bg-draft-bg text-draft-fg'],
    ['scheduled', 'bg-scheduled-bg text-scheduled-fg'],
    ['expired', 'bg-expired-bg text-expired-fg'],
    ['neutral', 'bg-wash text-ink-2'],
    ['accent', 'bg-accent-tint text-accent-ink'],
    ['alert', 'bg-surface text-alert'],
  ])('%s', (tone, classes) => {
    render(<Pill tone={tone}>{tone}</Pill>);
    expect(screen.getByText(tone).className).toContain(classes);
  });
});

describe('FormField', () => {
  it('labels the control and links the error for screen readers', () => {
    render(
      <FormField label="Email *" error="Please enter your email." hint="We reply here.">
        {(ids) => <Input {...ids} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Email *');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('We reply here. Please enter your email.');
  });

  it('is valid without an error', () => {
    render(<FormField label="Name">{(ids) => <Input {...ids} />}</FormField>);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Checkbox', () => {
  it('toggles through its label', () => {
    render(<Checkbox label="I agree" />);
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    fireEvent.click(screen.getByText('I agree'));
    expect(box).toBeChecked();
  });
});

describe('typography', () => {
  it('renders the semantic element of its level, overridable with `as`', () => {
    render(
      <>
        <Heading level={3}>Card</Heading>
        <Heading level={2} as="p">
          Not a heading
        </Heading>
        <Text as="p">Body text</Text>
      </>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Card' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not a heading' })).toBeNull();
    expect(screen.getByText('Body text').tagName).toBe('P');
  });

  it('sizes and weighs a heading from its level, overridable', () => {
    render(
      <>
        <Heading level={1}>Greeting</Heading>
        <Heading level={3}>Section</Heading>
        <Heading level={3} size="stat">
          42
        </Heading>
      </>,
    );
    expect(screen.getByText('Greeting').className).toMatch(/text-heading-lg .*font-bold/);
    expect(screen.getByText('Section').className).toMatch(/text-title .*font-title/);
    expect(screen.getByText('42').className).toMatch(/text-stat .*font-bold/);
  });
});
