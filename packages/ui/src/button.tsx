import type { ComponentPropsWithRef } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Visual emphasis. Defaults to `primary`. */
  variant?: ButtonVariant;
}

// min-h-11 keeps a 44px touch target.
const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary enabled:hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-ink enabled:hover:bg-canvas',
  danger: 'bg-danger text-on-primary enabled:hover:bg-danger-hover',
};

/** A native button that defaults to `type="button"` so it never submits a form by accident. */
export function Button({ variant = 'primary', type = 'button', className, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cx(BASE, VARIANTS[variant], className)}
      {...props}
    />
  );
}
