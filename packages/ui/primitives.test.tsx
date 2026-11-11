import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonClassName } from './button';
import { twMerge } from './cn';
import { Checkbox, FormField, Input } from './input';
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
    expect(buttonClassName({ variant: 'accent', className: 'text-nav' })).toContain('text-nav');
    expect(buttonClassName({ variant: 'accent', className: 'text-nav' })).not.toMatch(/\btext-body\b/);
    expect(twMerge('text-body text-ink-muted', 'text-heading-md')).toBe('text-ink-muted text-heading-md');
  });

  it.each([
    ['a section padding override', 'py-14 lg:py-section', 'lg:py-12', 'py-14 lg:py-12'],
    ['an arbitrary one', 'py-14 lg:py-section', 'lg:py-[92px]', 'py-14 lg:py-[92px]'],
    ['the token as the override', 'lg:py-10', 'lg:py-section', 'lg:py-section'],
    ['a margin', 'mt-4', 'mt-section', 'mt-section'],
  ])('merges the custom spacing (%s)', (_label, base, override, expected) => {
    expect(twMerge(base, override)).toBe(expected);
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
});
