'use client';

import { Button, type ButtonVariant } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { OneTimeSecretDialog } from '../one-time-secret-dialog';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';

/** Everything an action answered but its secret. */
function withoutSecret<Data extends { readonly secret: string }>(data: Data): Omit<Data, 'secret'> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'secret')) as Omit<
    Data,
    'secret'
  >;
}

export interface SecretActionButtonProps<Data extends { readonly secret: string }> {
  /** The button that opens the question. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly pendingLabel?: string;
  readonly tone?: 'danger' | 'primary';
  /** A server action that answers a secret the API returns once. */
  readonly action: (state: ActionState<Data>, formData: FormData) => Promise<ActionResult<Data>>;
  /** Hidden fields sent with the action, such as the resource id. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Form controls in the question, such as the overlap of a rotation. */
  readonly children?: ReactNode;
  readonly secretTitle: string;
  /** Names the secret, such as "Signing secret". */
  readonly secretLabel: string;
  readonly secretDescription?: (data: Omit<Data, 'secret'>) => ReactNode;
  /** After the secret dialog closed, with everything the action answered but the secret. */
  readonly onClosed?: (data: Omit<Data, 'secret'>) => void;
}

/**
 * Asks, runs a server action that returns a secret once (a rotated webhook secret, the secret or
 * token of a clone), then shows it in the one-time secret dialog (C21). The secret lives in this
 * component's state only while that dialog is open; the action state keeps nothing.
 */
export function SecretActionButton<Data extends { readonly secret: string }>({
  label,
  variant,
  title,
  description,
  confirmLabel,
  pendingLabel,
  tone = 'primary',
  action,
  fields,
  children,
  secretTitle,
  secretLabel,
  secretDescription,
  onClosed,
}: SecretActionButtonProps<Data>) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<Data | null>(null);
  // The action state keeps nothing (`useFormAction`): the secret goes to `revealed` only. A
  // refusal keeps what was entered in the question's controls (Workflow 2D K003).
  const form = useFormAction(action, {
    onSuccess: (data) => {
      setOpen(false);
      setRevealed(data);
    },
  });

  return (
    <>
      <Button
        variant={variant ?? 'secondary'}
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
      {revealed !== null && (
        <OneTimeSecretDialog
          open
          title={secretTitle}
          label={secretLabel}
          secret={revealed.secret}
          {...(secretDescription === undefined
            ? {}
            : {
                description: (
                  <>
                    {secretDescription(withoutSecret(revealed))} This is the only time the secret is
                    shown: copy it now and keep it somewhere safe.
                  </>
                ),
              })}
          onClose={() => {
            const data = withoutSecret(revealed);
            setRevealed(null);
            onClosed?.(data);
          }}
        />
      )}
    </>
  );
}
