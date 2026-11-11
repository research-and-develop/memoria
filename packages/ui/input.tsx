import * as React from 'react';
import { twMerge } from './cn';

/**
 * Form controls: 50 px
 * fields, a hairline border, 9 px radius, 14 px text. An invalid control is
 * marked with `aria-invalid` (the border turns red) — pair it with a message
 * linked through `aria-describedby` (see `FormField`).
 */

const field =
  'w-full rounded-field border border-line bg-white px-[13px] font-sans text-body-sm text-ink placeholder:text-ink-subtle transition-colors focus:border-brand-strong focus:outline-none focus:ring-2 focus:ring-brand-strong/25 disabled:cursor-not-allowed disabled:bg-brand-wash disabled:opacity-70 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25 motion-reduce:transition-none';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={twMerge(field, 'h-[50px]', className)} {...props} />
));
Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={twMerge(field, 'min-h-[90px] py-3', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** A native <select> (accessible and mobile-friendly for free) with the design's chevron. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <span className="relative block">
    <select ref={ref} className={twMerge(field, 'h-[50px] appearance-none pr-10', className)} {...props}>
      {children}
    </select>
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="pointer-events-none absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2 4.5 6 8.5l4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
));
Select.displayName = 'Select';

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: React.ReactNode };

/** An 18 px checkbox with its label to the right (e.g. a consent line). */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, id, ...props }, ref) => {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <span className={twMerge('flex items-start gap-3', className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-line accent-brand-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong focus-visible:ring-offset-2 aria-[invalid=true]:outline aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-danger"
        {...props}
      />
      <label htmlFor={inputId} className="cursor-pointer font-sans text-caption text-ink-muted">
        {label}
      </label>
    </span>
  );
});
Checkbox.displayName = 'Checkbox';

/**
 * Label + control + hint/error, wired for screen readers. The control is a
 * render prop so it receives the ids it must carry:
 *
 *   <FormField label="Email *" error={errors.email}>
 *     {(ids) => <Input type="email" {...ids} />}
 *   </FormField>
 */
export function FormField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: (ids: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => React.ReactNode;
}) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={twMerge('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="font-sans text-label font-bold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {hint ? (
        <p id={hintId} className="font-sans text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="font-sans text-caption font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
