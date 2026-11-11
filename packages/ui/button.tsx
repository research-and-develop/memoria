import * as React from 'react';
import { twMerge } from './cn';

/**
 * accent    the call to action of a section
 * primary   filled brand (brand-strong for AA white text)
 * outline   white with a line border
 * secondary lavender, for quiet actions in the admin
 * ghost     no surface; hover tint
 * link      brand text, no padding ("Read more →")
 * danger    destructive (admin)
 * inverse   white on a brand surface
 */
export type ButtonVariant = 'accent' | 'primary' | 'outline' | 'secondary' | 'ghost' | 'link' | 'danger' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Trailing "→", as on every CTA in the design. Decorative: hidden from screen readers. */
  arrow?: boolean;
};

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-sans font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-white disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none';

const variantClasses: Record<ButtonVariant, string> = {
  accent: 'bg-accent text-ink hover:bg-accent-strong focus-visible:ring-brand-strong',
  primary: 'bg-brand-strong text-white hover:bg-brand-deep focus-visible:ring-brand-strong',
  outline: 'border border-line bg-white text-ink hover:border-brand-border hover:bg-brand-wash focus-visible:ring-brand-strong',
  secondary: 'bg-brand-wash text-brand-deep hover:bg-brand-tint focus-visible:ring-brand-strong',
  ghost: 'bg-transparent text-ink hover:bg-brand-wash focus-visible:ring-brand-strong',
  link: 'h-auto bg-transparent px-0 text-brand-strong underline-offset-4 hover:underline focus-visible:ring-brand-strong',
  danger: 'bg-danger text-white hover:bg-danger-strong focus-visible:ring-danger',
  inverse: 'bg-white text-ink hover:bg-brand-wash focus-visible:ring-white ring-offset-brand-strong',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-[52px] px-6 text-body',
  lg: 'h-[54px] px-5 text-body',
  icon: 'h-10 w-10 p-0',
};

/**
 * The Button's classes, for a surface that must LOOK like a Button but cannot
 * BE one — above all a link (`<Link className={buttonClassName({ variant: 'accent' })}>`).
 */
export function buttonClassName(opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const variant = opts.variant ?? 'primary';
  return twMerge(base, variant === 'link' ? 'text-body' : sizeClasses[opts.size ?? 'md'], variantClasses[variant], opts.className);
}

/** The decorative trailing arrow of a CTA, for a link styled with `buttonClassName`. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <span aria-hidden className={twMerge('text-lg leading-none', className)}>
      →
    </span>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading = false, arrow = false, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={twMerge(buttonClassName({ variant, size }), loading ? 'cursor-wait' : '', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
      {arrow ? <ButtonArrow /> : null}
    </button>
  ),
);
Button.displayName = 'Button';
