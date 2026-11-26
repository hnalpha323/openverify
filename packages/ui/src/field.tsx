'use client';

import { createContext, use, useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { hasContent, joinIds } from './aria';
import { cx } from './cx';

interface FieldContextValue {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** Help text, announced as the control's description. */
  description?: ReactNode;
  /** Validation message; marks the control invalid and is announced after the description. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** A single `Input` (or another control that reads the field context). */
  children: ReactNode;
}

/** Labels a form control and wires its description and error message for assistive tech. */
export function Field({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const hasDescription = hasContent(description);
  const invalid = hasContent(error);
  const descriptionId = hasDescription ? `${id}-description` : undefined;
  const errorId = invalid ? `${id}-error` : undefined;

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
      {hasDescription && (
        <p id={descriptionId} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      <FieldContext
        value={{ id: controlId, describedBy: joinIds(descriptionId, errorId), invalid, required }}
      >
        {children}
      </FieldContext>
      {invalid && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** Marks the input invalid when used outside a `Field`; inside one, the field's error wins. */
  invalid?: boolean;
}

/** A text input. Inside a `Field` it takes the field's id, description, error and required state. */
export function Input({
  id,
  invalid,
  required,
  className,
  'aria-describedby': describedBy,
  ...props
}: InputProps) {
  const field = use(FieldContext);
  const isInvalid = invalid ?? field?.invalid ?? false;

  return (
    <input
      id={id ?? field?.id}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={joinIds(field?.describedBy, describedBy)}
      className={cx(
        'min-h-11 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
        isInvalid ? 'border-danger' : 'border-control',
        className,
      )}
      {...props}
    />
  );
}
