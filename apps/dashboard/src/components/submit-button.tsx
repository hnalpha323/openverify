'use client';

import { Button, type ButtonVariant } from '@openverify/ui';
import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export interface SubmitButtonProps {
  readonly children: ReactNode;
  /** Shown while the form's action runs, such as "Saving…". */
  readonly pendingLabel: ReactNode;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Posted with the form when this button submits it, for forms with several buttons. */
  readonly name?: string;
  readonly value?: string;
  /**
   * Whether the form's action runs, from `useFormAction`: React's form status does not see an
   * action dispatched from the submit event. Without it, the form status is used.
   */
  readonly pending?: boolean;
}

/** A form's submit button: disabled, with progress, while its action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  disabled = false,
  className,
  name,
  value,
  pending: running,
}: SubmitButtonProps) {
  const status = useFormStatus();
  const pending = running ?? status.pending;
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      {...(variant === undefined ? {} : { variant })}
      {...(className === undefined ? {} : { className })}
      {...(name === undefined ? {} : { name, value })}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
