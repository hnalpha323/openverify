import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { InviteUserButton, type InvitationSent } from './invite-user-button';
import type { RoleOption } from './role-options';
import { ROLE_IDS } from './test-fixtures';

type Invite = (
  state: ActionState<InvitationSent>,
  formData: FormData,
) => Promise<ActionResult<InvitationSent>>;

const ROLES: RoleOption[] = [
  { id: ROLE_IDS.admin, name: 'Admin', builtin: true, grantable: true },
  { id: ROLE_IDS.reviewer, name: 'Reviewer', builtin: true, grantable: true },
];

function renderButton(invite: Invite) {
  render(
    <ToastProvider>
      <InviteUserButton roles={ROLES} action={invite} />
    </ToastProvider>,
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Invite a user' }));
  return screen.getByRole('dialog', { name: 'Invite a user' });
}

describe('InviteUserButton', () => {
  it('invites by email with the chosen roles, then confirms and closes', async () => {
    const invite = vi.fn<Invite>(() =>
      Promise.resolve({
        ok: true,
        data: { email: 'new@example.test', expiresAt: '2026-10-27T04:35:00.000Z' },
      }),
    );
    renderButton(invite);

    const dialog = await openDialog();
    expect(dialog).toHaveAccessibleDescription(
      'We email them a link to choose their name and password. The link works for 7 days.',
    );
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@example.test');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Reviewer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    const formData = invite.mock.calls[0]?.[1];
    expect(formData?.get('email')).toBe('new@example.test');
    expect(formData?.getAll('role-ids')).toEqual([ROLE_IDS.reviewer]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to new@example.test. The link works until Oct 27, 2026, 4:35 AM UTC.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite a user' })).toHaveFocus();
  });

  it("keeps the dialog open with the API's problem and the field errors", async () => {
    const invite = vi.fn<Invite>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          detail: 'Some values are not valid.',
          errors: [
            { pointer: '/email', detail: 'Enter an email address.' },
            { pointer: '/role-ids', detail: 'Choose at least one role.' },
          ],
        },
      }),
    );
    renderButton(invite);

    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Email'), 'someone@example.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Check the values you entered',
    );
    expect(within(dialog).getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter an email address.',
    );
    expect(within(dialog).getByRole('group', { name: 'Roles' })).toHaveAccessibleDescription(
      'Choose at least one role.',
    );
  });

  it('shows a refusal without field errors, such as an email already in use', async () => {
    const invite = vi.fn<Invite>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Conflict',
          detail: 'A user with this email already exists in the organization.',
          status: 409,
        },
      }),
    );
    renderButton(invite);

    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Email'), 'admin@example.test');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Admin' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A user with this email already exists in the organization.',
    );
  });

  it('keeps what was typed and checked after a refusal, so it can be corrected', async () => {
    const invite = vi.fn<Invite>(() =>
      Promise.resolve({ ok: false, problem: { title: 'Conflict', status: 409 } }),
    );
    renderButton(invite);

    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Email'), 'someone@example.test');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Reviewer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Conflict');
    expect(within(dialog).getByLabelText('Email')).toHaveValue('someone@example.test');
    expect(within(dialog).getByRole('checkbox', { name: 'Reviewer' })).toBeChecked();
  });

  it('closes on Escape without inviting, and forgets what was typed', async () => {
    const invite = vi.fn<Invite>();
    renderButton(invite);

    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText('Email'), 'draft@example.test');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(invite).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Invite a user' })).toHaveFocus();
    const reopened = await openDialog();
    expect(within(reopened).getByLabelText('Email')).toHaveValue('');
  });

  it('cancels with the Cancel button', async () => {
    renderButton(vi.fn<Invite>());

    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
