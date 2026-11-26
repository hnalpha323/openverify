import { Alert } from '@openverify/ui';
import type { ActionState } from '../lib/action-state';
import { ProblemDisplay } from './problem-display';

export interface ActionFeedbackProps<Data> {
  readonly state: ActionState<Data>;
  /** Announced when the action succeeded; nothing is shown without it. */
  readonly successMessage?: string;
}

/** Below a form: the problem of a failed action, or its success message. */
export function ActionFeedback<Data>({ state, successMessage }: ActionFeedbackProps<Data>) {
  if (state === null) {
    return null;
  }
  if (!state.ok) {
    return <ProblemDisplay problem={state.problem} />;
  }
  return successMessage === undefined ? null : <Alert tone="success">{successMessage}</Alert>;
}
