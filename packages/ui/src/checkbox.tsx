import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { hasContent, joinIds } from './aria';
import { cx } from './cx';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  label: ReactNode;
  /** Extra detail, announced as the checkbox's description. */
  description?: ReactNode;
}

/** A native checkbox with its label beside it (the label is part of the click target). */
export function Checkbox({
  label,
  description,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const descriptionId = hasContent(description) ? `${generatedId}-description` : undefined;

  return (
    <div className={cx('flex items-start gap-3', className)}>
      <input
        type="checkbox"
        id={inputId}
        aria-describedby={joinIds(descriptionId, describedBy)}
        className="mt-0.5 size-6 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed"
        {...props}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm text-ink">
          {label}
        </label>
        {descriptionId !== undefined && (
          <p id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
