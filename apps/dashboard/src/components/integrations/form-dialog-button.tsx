'use client';

import { Button, type ButtonVariant } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

export interface FormDialogButtonProps<Data> {
  /** The button that opens the dialog. */
  readonly label: string;
  /** The button's accessible name when `label` alone does not say what it acts on (a row action). */
  readonly accessibleLabel?: string;
  readonly variant?: ButtonVariant;
  readonly title: string;
  readonly description?: ReactNode;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  /** `danger` for a destructive change; `primary` (the default) otherwise. */
  readonly tone?: 'primary' | 'danger';
  /** A server action built with `runAction`. */
  readonly action: (state: ActionState<Data>, formData: FormData) => Promise<ActionResult<Data>>;
  /** Hidden fields sent with the form, such as the resource id. */
  readonly fields?: Readonly<Record<string, string>>;
  /** The form's controls, given the problem of a refused submission for their errors. */
  readonly children: (problem: DisplayProblem | undefined) => ReactNode;
  /** Shown as a toast once the action succeeded. */
  readonly successMessage?: string;
  readonly onSuccess?: (data: Data) => void;
}

/**
 * A button that opens a small form in a dialog (rename a key, choose when it expires). A refused
 * submission keeps what the operator typed and shows the problem; a successful one closes the
 * dialog, which returns focus to the button, and confirms with a toast.
 */
export function FormDialogButton<Data = undefined>({
  label,
  accessibleLabel,
  variant = 'secondary',
  title,
  description,
  submitLabel,
  pendingLabel,
  tone = 'primary',
  action,
  fields = {},
  children,
  successMessage,
  onSuccess,
}: FormDialogButtonProps<Data>) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const submit = useFormAction(action, {
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
        variant={variant}
        aria-label={accessibleLabel}
        onClick={() => {
          submit.clearProblem();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={title}
        {...(description === undefined ? {} : { description })}
        dismissible={!submit.pending}
      >
        <form {...submit.formProps} noValidate className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children(submit.problem)}
          <ProblemDisplay problem={submit.problem} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={submit.pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant={tone} disabled={submit.pending}>
              {submit.pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
