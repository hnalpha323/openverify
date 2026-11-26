'use client';

/**
 * Dismissing one list match (C99.3, C108): a dialog with a required reason. Focus moves into the
 * dialog and back to the button; a refusal of the reason shows on its field, tied to it
 * (`aria-invalid` and its description), and is not repeated in the summary.
 */
import { LIST_LIMITS } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const REASON = '/data/attributes/reason';

export function DismissListMatchButton({
  matchId,
  action,
  fields,
}: {
  readonly matchId: string;
  readonly action: Action;
  /** Hidden fields beside the match id: the page a dismissal refreshes. */
  readonly fields: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const submit = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      show({ tone: 'success', message: 'The list match was dismissed.' });
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        aria-label={`Dismiss list match ${matchId}`}
        onClick={() => {
          submit.clearProblem();
          setOpen(true);
        }}
      >
        Dismiss
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Dismiss this list match?"
        description="A dismissed match stays recorded with its reason, and no longer counts as open."
        dismissible={!submit.pending}
      >
        <form {...submit.formProps} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="list-match-id" value={matchId} />
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <FormField
            label="Reason"
            required
            description={`Why this match does not apply, up to ${String(LIST_LIMITS.dismissReasonLength)} characters.`}
            error={fieldErrorOf(submit.problem, REASON)}
          >
            {(control) => (
              <textarea
                {...control}
                name="reason"
                rows={3}
                maxLength={LIST_LIMITS.dismissReasonLength}
                className={controlClassName(control)}
              />
            )}
          </FormField>
          <ProblemDisplay problem={withoutFieldErrors(submit.problem, [REASON])} />
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
            <Button type="submit" disabled={submit.pending}>
              {submit.pending ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
