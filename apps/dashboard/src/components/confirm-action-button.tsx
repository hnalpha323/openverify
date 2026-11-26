'use client';

import { Button, type ButtonVariant } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import type { ActionResult, ActionState } from '../lib/action-state';
import { ConfirmDialog } from './confirm-dialog';
import { ProblemDisplay } from './problem-display';
import { useToast } from './toasts';
import { useFormAction } from './use-form-action';

export interface ConfirmActionButtonProps<Data> {
  /** The button that opens the dialog. */
  readonly label: string;
  /**
   * The button's accessible name when `label` alone does not say what it acts on, such as a row
   * action ("Remove the spouse relation to acc_…", WCAG 2.4.6). It starts with `label`, so the
   * name contains the visible text (WCAG 2.5.3).
   */
  readonly accessibleLabel?: string;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly tone?: 'danger' | 'primary';
  /** A server action built with `runAction` (`lib/api/action.ts`). */
  readonly action: (state: ActionState<Data>, formData: FormData) => Promise<ActionResult<Data>>;
  /** Hidden fields sent with the action, such as the resource id. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Form controls in the dialog, such as a reason. */
  readonly children?: ReactNode;
  /** Shown as a toast once the action succeeded. */
  readonly successMessage?: string;
  readonly onSuccess?: (data: Data) => void;
}

/**
 * A button that asks for confirmation, then runs a server action. On success the dialog closes
 * and a toast confirms; on failure the dialog stays open with the problem.
 */
export function ConfirmActionButton<Data = undefined>({
  label,
  accessibleLabel,
  variant,
  disabled = false,
  title,
  description,
  confirmLabel,
  pendingLabel,
  tone = 'danger',
  action,
  fields,
  children,
  successMessage,
  onSuccess,
}: ConfirmActionButtonProps<Data>) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  // A refusal keeps what was entered in the dialog's controls (Workflow 2D K003).
  const form = useFormAction(action, {
    onSuccess: (data) => {
      setOpen(false);
      if (successMessage !== undefined) {
        show({ tone: 'success', message: successMessage });
      }
      onSuccess?.(data);
    },
  });

  return (
    <>
      <Button
        variant={variant ?? (tone === 'danger' ? 'danger' : 'secondary')}
        disabled={disabled}
        aria-label={accessibleLabel}
        onClick={() => {
          form.clearProblem();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        {...(description === undefined ? {} : { description })}
        confirmLabel={confirmLabel}
        {...(pendingLabel === undefined ? {} : { pendingLabel })}
        tone={tone}
        pending={form.pending}
        onCancel={() => {
          setOpen(false);
        }}
        formAction={form.formProps.action}
        onSubmit={form.formProps.onSubmit}
        {...(fields === undefined ? {} : { fields })}
      >
        {children}
        <ProblemDisplay problem={form.problem} />
      </ConfirmDialog>
    </>
  );
}
