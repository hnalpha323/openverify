import { cx } from '@openverify/ui';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

/**
 * The `*` of a required field, beside its label rather than inside it, so the label's text is
 * the field's name alone (for assistive technology and for `getByLabelText` alike); the control
 * itself carries `required`. The form says what the mark means.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-sm font-medium text-danger">
      *
    </span>
  );
}

export interface FormFieldProps extends ComponentPropsWithRef<'input'> {
  readonly label: ReactNode;
  /** Help text, announced as the control's description. */
  readonly description?: ReactNode;
  /** Validation message; marks the control invalid and is announced after the description. */
  readonly error?: ReactNode;
}

const present = (node: ReactNode) => node !== undefined && node !== null && node !== '';

/**
 * A native `input` with its label, description and error wired for assistive technology,
 * styled like `@openverify/ui`'s `Field` and `Input` (C64.1 forms). A required field shows the
 * `RequiredMark` beside its label.
 */
export function FormField({ label, description, error, required, ...props }: FormFieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const descriptionId = present(description) ? `${id}-description` : undefined;
  const errorId = present(error) ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1">
        <label htmlFor={controlId} className="text-sm font-medium text-ink">
          {label}
        </label>
        {required === true && <RequiredMark />}
      </div>
      {descriptionId !== undefined && (
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      <input
        id={controlId}
        required={required}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cx(
          'min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
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
