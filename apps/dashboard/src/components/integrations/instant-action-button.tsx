'use client';

import type { ButtonVariant } from '@openverify/ui';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

export interface InstantActionButtonProps {
  readonly label: string;
  /** Shown while the action runs, such as "Enabling…". */
  readonly pendingLabel: string;
  readonly variant?: ButtonVariant;
  /** A server action built with `runAction`. */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields sent with the action, such as the resource id. */
  readonly fields: Readonly<Record<string, string>>;
  /** Shown as a toast once the action succeeded. */
  readonly successMessage: string;
}

/**
 * A button that runs a harmless, reversible server action at once (enable, disable): no
 * question, a toast on success, the problem beside it on failure.
 */
export function InstantActionButton({
  label,
  pendingLabel,
  variant = 'secondary',
  action,
  fields,
  successMessage,
}: InstantActionButtonProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: successMessage });
    },
  });

  return (
    <form {...formProps} className="flex flex-col gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} pendingLabel={pendingLabel} pending={pending}>
        {label}
      </SubmitButton>
      <ProblemDisplay problem={problem} />
    </form>
  );
}
