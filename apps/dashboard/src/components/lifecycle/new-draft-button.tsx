'use client';

import type { ActionResult, ActionState } from '../../lib/action-state';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { problemSentence } from './tag-editor';

type Action = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

/**
 * Drafts a new version from the template's current one; the action then opens its editor. A
 * refusal shows as a toast.
 */
export function NewDraftButton({
  templateId,
  action,
}: {
  readonly templateId: string;
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, formProps } = useFormAction(action, {
    onProblem: (problem) => {
      show({ tone: 'error', message: problemSentence(problem) });
    },
  });
  return (
    <form {...formProps}>
      <input type="hidden" name="inquiry-template-id" value={templateId} />
      <SubmitButton pendingLabel="Drafting…" pending={pending}>
        New draft
      </SubmitButton>
    </form>
  );
}
