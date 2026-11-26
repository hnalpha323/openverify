import { cx } from '@openverify/ui';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { RequiredMark } from './form-field';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps extends Omit<ComponentPropsWithRef<'select'>, 'children'> {
  readonly label: ReactNode;
  readonly options: readonly SelectOption[];
  /** A first option with an empty value, shown until the user chooses (C64.1 forms). */
  readonly placeholder?: string;
  /** Validation message; marks the control invalid and is its accessible description. */
  readonly error?: ReactNode;
}

const present = (node: ReactNode) => node !== undefined && node !== null && node !== '';

/**
 * A native `select` with its label, styled like `@openverify/ui`'s `Field` (which has no select):
 * a required one shows the `RequiredMark` beside its label, and an error is its description.
 */
export function SelectField({
  label,
  options,
  placeholder,
  error,
  required,
  ...props
}: SelectFieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const errorId = present(error) ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1">
        <label htmlFor={controlId} className="text-sm font-medium text-ink">
          {label}
        </label>
        {required === true && <RequiredMark />}
      </div>
      <select
        id={controlId}
        required={required}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={errorId}
        className={cx(
          'min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
          errorId === undefined ? 'border-control' : 'border-danger',
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {errorId !== undefined && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
