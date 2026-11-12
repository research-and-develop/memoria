import * as React from 'react';
import { twMerge } from './cn';

/**
 * Buttons. The look is two maps below (variant → colours, size → box); the colours are theme roles,
 * so a restyle is a theme edit (theme/studio.mjs) and a new variant is one line.
 *
 * primary    accent fill: the main action of a screen (Publish, Submit, Deliver)
 * dark       ink fill: a strong neutral action (New gallery, Back up now)
 * secondary  surface with a border: everything else
 * ghost      no surface; hover wash (toolbars, menus)
 * danger     destructive
 * link       accent text, no box
 */
export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

const BASE =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button font-sans font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ring-offset-surface disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-inverse hover:bg-accent-ink',
  dark: 'bg-ink text-inverse hover:bg-ink-hover',
  secondary: 'border border-line-control bg-surface text-ink hover:bg-wash',
  ghost: 'bg-transparent text-ink hover:bg-wash',
  danger: 'bg-danger text-inverse hover:bg-danger/90',
  link: 'h-auto bg-transparent px-0 text-body text-accent-ink underline-offset-4 hover:underline',
};

/** On a touch screen (`coarse:`) a transparent ::before grows the hit area to 44 px. */
const HIT_AREA = "coarse:before:absolute coarse:before:content-['']";

const SIZE: Record<ButtonSize, string> = {
  sm: `h-9 px-3 text-body-sm ${HIT_AREA} coarse:before:inset-x-0 coarse:before:-inset-y-1`,
  md: `h-10 px-4 text-body ${HIT_AREA} coarse:before:inset-x-0 coarse:before:-inset-y-0.5`,
  lg: 'h-11 px-5 text-body',
  xl: 'h-[52px] px-6 text-body-lg',
  icon: `h-10 w-10 p-0 ${HIT_AREA} coarse:before:-inset-0.5`,
};

type CommonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Fully rounded. */
  pill?: boolean;
  loading?: boolean;
  /** A trailing "→". Decorative: hidden from screen readers. */
  arrow?: boolean;
};

/** An icon-only button has no text, so it must carry its name in `aria-label`. */
export type ButtonProps =
  | (CommonProps & { size?: Exclude<ButtonSize, 'icon'> })
  | (CommonProps & { size: 'icon'; 'aria-label': string });

/**
 * The Button's classes, for something that must LOOK like a button but cannot BE one, above all a
 * link: `<Link className={buttonClassName({ variant: 'primary' })}>`.
 */
export function buttonClassName(opts: { variant?: ButtonVariant; size?: ButtonSize; pill?: boolean; className?: string } = {}) {
  const variant = opts.variant ?? 'primary';
  return twMerge(BASE, variant === 'link' ? '' : SIZE[opts.size ?? 'md'], VARIANT[variant], opts.pill ? 'rounded-full' : '', opts.className);
}

/** The decorative trailing arrow, for a link styled with `buttonClassName`. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <span aria-hidden className={twMerge('leading-none', className)}>
      →
    </span>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', pill = false, loading = false, arrow = false, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={twMerge(buttonClassName({ variant, size, pill }), loading ? 'cursor-wait' : '', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
      {arrow ? <ButtonArrow /> : null}
    </button>
  ),
);
Button.displayName = 'Button';
