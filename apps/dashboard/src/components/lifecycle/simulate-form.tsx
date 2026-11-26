'use client';

import type { InquirySimulateAction } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

export { simulateActionsFor } from './inquiry-action-names';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const LABELS: Readonly<Record<InquirySimulateAction, string>> = {
  start_inquiry: 'Start (as the end user)',
  complete_inquiry: 'Complete',
  fail_inquiry: 'Fail',
  expire_inquiry: 'Expire',
  approve_inquiry: 'Approve',
  decline_inquiry: 'Decline',
  mark_for_review_inquiry: 'Mark for review',
};

export interface SimulateFormProps {
  readonly inquiryId: string;
  /** The actions allowed now (`simulateActionsFor`). */
  readonly actions: readonly InquirySimulateAction[];
  readonly action: Action;
}

/** Moves a sandbox inquiry through its lifecycle without an end user (C10, sandbox only). */
export function SimulateForm({ inquiryId, actions, action }: SimulateFormProps) {
  const { show } = useToast();
  // A refusal keeps the chosen action (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'The simulated action ran.' });
    },
  });

  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="inquiry-id" value={inquiryId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Simulated action" className="min-w-56">
          {(control) => (
            <select {...control} name="type" className={controlClassName(control)}>
              {actions.map((name) => (
                <option key={name} value={name}>
                  {LABELS[name]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Running…" pending={pending}>
          Run in the sandbox
        </SubmitButton>
      </div>
      <ProblemDisplay problem={problem} />
    </form>
  );
}
