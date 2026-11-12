import * as React from 'react';
import { twMerge } from './cn';

/**
 * Form controls: 44 px fields on a surface fill with an input border, 16 px text on phones (iOS
 * zooms into a smaller field) and 15 px from `sm` up. Colours are theme roles (theme/studio.mjs).
 * The input border is fainter than WCAG 1.4.11's 3:1 by design; a visible label above, the surface
 * fill and the focus ring carry the field instead (plan_202611_p00_foundation D0.7).
 * An invalid control is marked with `aria-invalid` (the border turns danger): pair it with a
 * message linked through `aria-describedby` (see `FormField`).
 */

const FIELD =
  'w-full rounded-control border border-line-input bg-surface px-3 font-sans text-field text-ink placeholder:text-ink-muted transition-colors sm:text-body-lg focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 disabled:cursor-not-allowed disabled:bg-wash disabled:text-ink-faint aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25 motion-reduce:transition-none';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={twMerge(FIELD, 'h-11', className)} {...props} />
));
Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={twMerge(FIELD, 'min-h-[96px] py-2.5', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** A native <select> (accessible and mobile-friendly for free) with the design's chevron. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <span className="relative block">
    <select ref={ref} className={twMerge(FIELD, 'h-11 appearance-none pr-10', className)} {...props}>
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

/** An 18 px checkbox with its label to the right, in a row at least 44 px tall (a touch target). */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, id, ...props }, ref) => {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <span className={twMerge('flex min-h-11 items-center gap-3', className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-line-input accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 aria-[invalid=true]:outline aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-danger"
        {...props}
      />
      <label htmlFor={inputId} className="cursor-pointer font-sans text-body-sm text-ink-2">
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
      <label htmlFor={id} className="font-sans text-body-sm font-semibold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {hint ? (
        <p id={hintId} className="font-sans text-caption text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="font-sans text-body-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
