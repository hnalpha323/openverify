import { cx } from '@openverify/ui';
import { useId, type ReactNode } from 'react';

/** What a `FormField` hands its control: spread these onto the input, select or textarea. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly required?: true;
}

export interface FormFieldProps {
  readonly label: ReactNode;
  /** Help text, announced as the control's description. */
  readonly description?: ReactNode;
  /** A validation message (for example `fieldErrorOf(problem, '/name')`); marks it invalid. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: (control: FieldControlProps) => ReactNode;
}

/**
 * Labels any form control and wires its description and error for assistive tech. For text
 * inputs, `@openverify/ui`'s `Field` and `Input` do the same; this one also serves selects and
 * text areas:
 *
 * ```tsx
 * <FormField label="Status" error={fieldErrorOf(problem, '/data/attributes/status')}>
 *   {(control) => <select {...control} name="status" className={controlClassName(control)} />}
 * </FormField>
 * ```
 */
export function FormField({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const invalid = error !== undefined && error !== null && error !== '';
  const errorId = invalid ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ');

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {' *'}
          </span>
        )}
      </label>
      {descriptionId !== undefined && (
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      {children({
        id: controlId,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
        ...(invalid ? { 'aria-invalid': true as const } : {}),
        ...(required ? { required: true as const } : {}),
      })}
      {invalid && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The console's control styles, with the danger border when invalid. */
export function controlClassName(control: { readonly 'aria-invalid'?: boolean }): string {
  return cx(
    'min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
    control['aria-invalid'] === true ? 'border-danger' : 'border-control',
  );
}
