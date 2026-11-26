import { cx } from '@openverify/ui';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

export interface TextAreaFieldProps extends ComponentPropsWithRef<'textarea'> {
  readonly label: ReactNode;
  /** Help text, announced as the control's description. */
  readonly description?: ReactNode;
  /** Validation message; marks the control invalid and is announced after the description. */
  readonly error?: ReactNode;
}

const present = (node: ReactNode) => node !== undefined && node !== null && node !== '';

/**
 * A native `textarea` with its label, description and error wired for assistive technology,
 * styled like `@openverify/ui`'s `Input` (the package has no textarea).
 */
export function TextAreaField({ label, description, error, ...props }: TextAreaFieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const descriptionId = present(description) ? `${id}-description` : undefined;
  const errorId = present(error) ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-medium text-ink">
        {label}
      </label>
      {descriptionId !== undefined && (
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      <textarea
        id={controlId}
        rows={4}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cx(
          'w-full rounded-md border bg-surface px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          errorId === undefined ? 'border-control' : 'border-danger',
        )}
        {...props}
      />
      {errorId !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
