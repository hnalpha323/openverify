'use client';

import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** Links inquiries, typed by id, to an account (`add-objects`). */
export function AddInquiriesForm({
  accountId,
  action,
}: {
  readonly accountId: string;
  readonly action: Action;
}) {
  const { show } = useToast();
  // A refusal keeps the IDs typed; a success empties the field (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'Added the inquiries.' });
    },
  });
  const idsError = fieldErrorOf(problem, '/meta/objects');
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="account-id" value={accountId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label="Inquiry IDs"
          description="Separate several with commas or spaces. They move to this account."
          error={idsError}
          className="min-w-64 flex-1"
        >
          {(control) => (
            <input
              {...control}
              name="inquiry-ids"
              autoComplete="off"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Adding…" pending={pending}>
          Add inquiries
        </SubmitButton>
      </div>
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/meta/objects'])} />
    </form>
  );
}
