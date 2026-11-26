'use client';

import type { ButtonVariant } from '@openverify/ui';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { REDACT_PHRASE, type InquiryTransitionAction } from './inquiry-action-names';
import { TypedConfirmButton } from './typed-confirm-button';

export { inquiryActionsFor } from './inquiry-action-names';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface InquiryActionsProps {
  readonly inquiryId: string;
  /** The status actions this operator may run now (`inquiryActionsFor`, with `inquiries:write`). */
  readonly actions: readonly InquiryTransitionAction[];
  /** The operator holds `inquiries:redact` and the inquiry is not redacted yet. */
  readonly canRedact: boolean;
  readonly transition: Action;
  readonly redact: Action;
}

const ACTIONS: Readonly<
  Record<
    InquiryTransitionAction,
    {
      readonly label: string;
      readonly variant: ButtonVariant;
      readonly tone: 'primary' | 'danger';
      readonly title: string;
      readonly description: string;
      readonly confirmLabel: string;
      readonly pendingLabel: string;
      readonly successMessage: string;
    }
  >
> = {
  approve: {
    label: 'Approve',
    variant: 'primary',
    tone: 'primary',
    title: 'Approve this inquiry?',
    description: 'The inquiry becomes approved. A decision cannot be changed afterwards.',
    confirmLabel: 'Approve inquiry',
    pendingLabel: 'Approving…',
    successMessage: 'The inquiry was approved.',
  },
  decline: {
    label: 'Decline',
    variant: 'secondary',
    tone: 'danger',
    title: 'Decline this inquiry?',
    description: 'The inquiry becomes declined. A decision cannot be changed afterwards.',
    confirmLabel: 'Decline inquiry',
    pendingLabel: 'Declining…',
    successMessage: 'The inquiry was declined.',
  },
  'mark-for-review': {
    label: 'Mark for review',
    variant: 'secondary',
    tone: 'primary',
    title: 'Mark this inquiry for review?',
    description: 'It moves to Needs review, where it can then be approved or declined.',
    confirmLabel: 'Mark for review',
    pendingLabel: 'Marking…',
    successMessage: 'The inquiry was marked for review.',
  },
  expire: {
    label: 'Expire',
    variant: 'secondary',
    tone: 'danger',
    title: 'Expire this inquiry?',
    description:
      'The end user can no longer finish it. Its active sessions and unfinished verifications are canceled.',
    confirmLabel: 'Expire inquiry',
    pendingLabel: 'Expiring…',
    successMessage: 'The inquiry was expired.',
  },
};

/**
 * The inquiry's decisions and redaction (C10, C16): only those the operator's permissions and the
 * inquiry's status allow, each behind a confirmation. The API enforces both again.
 */
export function InquiryActions({
  inquiryId,
  actions,
  canRedact,
  transition,
  redact,
}: InquiryActionsProps) {
  if (actions.length === 0 && !canRedact) {
    return null;
  }
  return (
    <div role="group" aria-label="Inquiry actions" className="flex flex-wrap gap-3">
      {actions.map((name) => {
        const { label, ...dialog } = ACTIONS[name];
        return (
          <ConfirmActionButton
            key={name}
            label={label}
            {...dialog}
            action={transition}
            fields={{ 'inquiry-id': inquiryId, action: name }}
          />
        );
      })}
      {canRedact && (
        <TypedConfirmButton
          label="Redact"
          title="Redact this inquiry?"
          description="Its fields, note, files, check details and the personal data in its events are deleted for good. This cannot be undone."
          phrase={REDACT_PHRASE}
          confirmLabel="Redact inquiry"
          pendingLabel="Redacting…"
          action={redact}
          fields={{ 'inquiry-id': inquiryId }}
          successMessage="The inquiry was redacted."
        />
      )}
    </div>
  );
}
