'use client';

import type { ActionResult, ActionState } from '../../lib/action-state';
import { problemSentence } from '../lifecycle/tag-editor';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

/**
 * Drafts a new version of a report template from what its current version sets (C71.1); the
 * action then opens the draft's editor. A refusal shows as a toast.
 */
export function NewReportDraftButton({
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
      <input type="hidden" name="report-template-id" value={templateId} />
      <SubmitButton pendingLabel="Drafting…" pending={pending}>
        New draft
      </SubmitButton>
    </form>
  );
}
