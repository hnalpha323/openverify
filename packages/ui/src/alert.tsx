import type { ComponentPropsWithRef, ReactNode } from 'react';
import { hasContent } from './aria';
import { cx } from './cx';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Defaults to `info`. Errors and warnings interrupt (`role="alert"`); the rest wait (`status`). */
  tone?: AlertTone;
  title?: ReactNode;
}

const TONES: Record<AlertTone, { readonly role: 'alert' | 'status'; readonly className: string }> =
  {
    info: { role: 'status', className: 'border-blue-300 bg-blue-50 text-blue-900' },
    success: { role: 'status', className: 'border-green-300 bg-green-50 text-green-900' },
    warning: { role: 'alert', className: 'border-amber-300 bg-amber-50 text-amber-900' },
    error: { role: 'alert', className: 'border-red-300 bg-red-50 text-red-900' },
  };

/** A message in a live region, so screen readers announce it when it appears. */
export function Alert({ tone = 'info', title, className, children, ...props }: AlertProps) {
  const { role, className: toneClassName } = TONES[tone];

  return (
    <div
      role={role}
      data-tone={tone}
      className={cx('rounded-lg border border-s-4 p-4 text-sm', toneClassName, className)}
      {...props}
    >
      {hasContent(title) && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}
