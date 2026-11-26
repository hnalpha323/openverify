'use client';

import { Button } from '@openverify/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

export interface TypedConfirmButtonProps {
  /** The button that opens the dialog. */
  readonly label: string;
  readonly title: string;
  /** What happens, and that it cannot be undone. */
  readonly description: ReactNode;
  /** What the operator types to confirm, such as `redact`; sent as `confirmation`. */
  readonly phrase: string;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  /** A server action built with `runAction`. */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields sent with the action, such as the resource id. */
  readonly fields: Readonly<Record<string, string>>;
  readonly successMessage: string;
}

/**
 * A destructive action that cannot be undone, such as a redaction: the confirm button works only
 * once the operator typed the phrase. The server action checks the phrase again.
 */
export function TypedConfirmButton({
  label,
  title,
  description,
  phrase,
  confirmLabel,
  pendingLabel,
  action,
  fields,
  successMessage,
}: TypedConfirmButtonProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { show } = useToast();
  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      setTyped('');
      show({ tone: 'success', message: successMessage });
    },
  });
  const close = () => {
    setOpen(false);
    setTyped('');
    clearProblem();
  };

  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={description}
        initialFocus={cancelRef}
        dismissible={!pending}
        size="sm"
      >
        <form {...formProps} className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-phrase`} className="text-sm font-medium text-ink">
              Type {phrase} to confirm
            </label>
            <input
              id={`${id}-phrase`}
              name="confirmation"
              value={typed}
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(event) => {
                setTyped(event.currentTarget.value);
              }}
              className={controlClassName({})}
            />
          </div>
          <ProblemDisplay problem={problem} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending || typed !== phrase}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
