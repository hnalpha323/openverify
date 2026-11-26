'use client';

import { Button } from '@openverify/ui';
import { useRef, type ReactNode, type SubmitEvent } from 'react';
import { Dialog } from './dialog';

export interface ConfirmDialogProps {
  readonly open: boolean;
  /** The question, such as "Redact this inquiry?". */
  readonly title: ReactNode;
  /** What happens, and whether it can be undone. */
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  /** Shown on the confirm button while `pending`; defaults to `confirmLabel`. */
  readonly pendingLabel?: string;
  readonly cancelLabel?: string;
  /** `danger` (the default) for destructive actions, `primary` otherwise. */
  readonly tone?: 'danger' | 'primary';
  /** While the action runs: both buttons and Escape are disabled. */
  readonly pending?: boolean;
  readonly onCancel: () => void;
  /** For an action run from client code. */
  readonly onConfirm?: () => void;
  /** For a server action: the confirm button submits a form with `fields` and `children`. */
  readonly formAction?: (formData: FormData) => void | Promise<void>;
  /** The form's submit handler, from `useFormAction` (it keeps what was entered on refusal). */
  readonly onSubmit?: (event: SubmitEvent<HTMLFormElement>) => void;
  /** Hidden form fields, such as the id of the resource. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Extra content or form controls, such as a reason, or a problem to show. */
  readonly children?: ReactNode;
}

/**
 * Asks before an action. Cancel gets focus first, so Enter never confirms a destructive action
 * by accident.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
  onCancel,
  onConfirm,
  formAction,
  onSubmit,
  fields = {},
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const buttons = (
    <div className="flex flex-wrap justify-end gap-3">
      <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        type={formAction === undefined ? 'button' : 'submit'}
        variant={tone}
        disabled={pending}
        {...(formAction === undefined ? { onClick: onConfirm } : {})}
      >
        {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
      </Button>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      {...(description === undefined ? {} : { description })}
      initialFocus={cancelRef}
      dismissible={!pending}
      size="sm"
    >
      {formAction === undefined ? (
        <>
          {children}
          {buttons}
        </>
      ) : (
        <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          {buttons}
        </form>
      )}
    </Dialog>
  );
}
