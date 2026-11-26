'use client';

import { Button, Field, Input } from '@openverify/ui';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { ProblemDisplay } from '../problem-display';
import { formatUtc } from '../timestamp';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { withoutFieldErrors } from '../field-errors';
import { RoleChecklist } from './role-checklist';
import type { RoleOption } from './role-options';

/** What an invitation action answers: who was invited, and until when the link works. */
export interface InvitationSent {
  readonly email: string;
  readonly expiresAt: string;
}

export type InvitationAction = (
  state: ActionState<InvitationSent>,
  formData: FormData,
) => Promise<ActionResult<InvitationSent>>;

/** The toast after an invitation was sent (or sent again). */
export function invitationSentMessage({ email, expiresAt }: InvitationSent): string {
  return `Invitation sent to ${email}. The link works until ${formatUtc(expiresAt)} UTC.`;
}

const FIELD_POINTERS = ['/email', '/role-ids'];

export interface InviteUserButtonProps {
  /** Every role, with whether the operator may grant it (`roleOptions`). */
  readonly roles: readonly RoleOption[];
  /** `inviteUser` from `app/users/actions.ts`. */
  readonly action: InvitationAction;
}

/**
 * Invites a new operator (C15): an email address and roles. The API emails a link to
 * `/accept-invitation`, where the invitee chooses a name and a password; the link's token never
 * reaches the dashboard.
 */
export function InviteUserButton({ roles, action }: InviteUserButtonProps) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: (sent) => {
      setOpen(false);
      show({ tone: 'success', message: invitationSentMessage(sent) });
    },
  });

  const close = () => {
    setOpen(false);
    clearProblem();
  };

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Invite a user
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Invite a user"
        description="We email them a link to choose their name and password. The link works for 7 days."
        dismissible={!pending}
      >
        <form {...formProps} className="flex flex-col gap-4">
          <Field label="Email" error={fieldErrorOf(problem, '/email')}>
            <Input type="email" name="email" maxLength={254} autoComplete="off" required />
          </Field>
          <RoleChecklist
            options={roles}
            defaultChecked={[]}
            error={fieldErrorOf(problem, '/role-ids')}
          />
          <ProblemDisplay problem={withoutFieldErrors(problem, FIELD_POINTERS)} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
