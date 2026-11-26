'use client';

/**
 * C128.6, C142.4: reopen a declined inquiry for human review. A button, a confirmation and a
 * required comment, calling the inquiry's own route (`POST /inquiries/:id/reopen`, users with
 * `inquiries:write`); no keyboard shortcut decides anything.
 */
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField, controlClassName } from '../form-field';

export function ReopenInquiryButton({
  inquiryId,
  action,
}: {
  readonly inquiryId: string;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  return (
    <ConfirmActionButton
      label="Reopen for review"
      variant="secondary"
      tone="primary"
      title="Reopen this inquiry for review?"
      description="It moves from declined to needs review, and automated declines are refused until a person decides. The face template deleted by the decline is not restored."
      confirmLabel="Reopen inquiry"
      pendingLabel="Reopening…"
      action={action}
      fields={{ 'inquiry-id': inquiryId }}
      successMessage="The inquiry was reopened for review."
    >
      <FormField
        label="Comment"
        description="Why it is reopened. Kept in the decision record."
        required
      >
        {(control) => (
          <textarea
            {...control}
            name="comment"
            rows={3}
            maxLength={2000}
            className={controlClassName(control)}
          />
        )}
      </FormField>
    </ConfirmActionButton>
  );
}
