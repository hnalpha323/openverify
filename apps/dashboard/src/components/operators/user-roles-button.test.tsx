import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import type { RoleOption } from './role-options';
import { ROLE_IDS, USER_IDS } from './test-fixtures';
import { UserRolesButton } from './user-roles-button';

type Update = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ROLES: RoleOption[] = [
  { id: ROLE_IDS.admin, name: 'Admin', builtin: true, grantable: true },
  { id: ROLE_IDS.reviewer, name: 'Reviewer', builtin: true, grantable: true },
  { id: ROLE_IDS.viewer, name: 'Viewer', builtin: true, grantable: true },
];

function renderButton(
  update: Update,
  roles: readonly RoleOption[] = ROLES,
  current: readonly string[] = [ROLE_IDS.reviewer],
) {
  render(
    <ToastProvider>
      <UserRolesButton
        userId={USER_IDS.reviewer}
        userLabel="Synthetic Reviewer"
        roles={roles}
        currentRoleIds={current}
        action={update}
      />
    </ToastProvider>,
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit roles of Synthetic Reviewer' }));
  return screen.getByRole('dialog', { name: 'Roles of Synthetic Reviewer' });
}

describe('UserRolesButton', () => {
  it("replaces the user's roles with the ones checked", async () => {
    const update = vi.fn<Update>(() => Promise.resolve({ ok: true, data: undefined }));
    renderButton(update);

    const dialog = await openDialog();
    expect(within(dialog).getByRole('checkbox', { name: 'Reviewer' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Viewer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    const formData = update.mock.calls[0]?.[1];
    expect(formData?.get('user-id')).toBe(USER_IDS.reviewer);
    expect(formData?.getAll('role-ids')).toEqual([ROLE_IDS.reviewer, ROLE_IDS.viewer]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The roles of Synthetic Reviewer were updated.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the refusal to demote the last active admin (409)', async () => {
    const update = vi.fn<Update>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Conflict',
          detail: 'The organization’s last active admin cannot be demoted or deactivated.',
          status: 409,
        },
      }),
    );
    renderButton(update, ROLES, [ROLE_IDS.admin]);

    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Admin' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Viewer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The organization’s last active admin cannot be demoted or deactivated.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
    // The choice survives the refusal.
    expect(within(dialog).getByRole('checkbox', { name: 'Admin' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Viewer' })).toBeChecked();
  });

  it('shows a field error on the roles group', async () => {
    const update = vi.fn<Update>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/data/attributes/role-ids', detail: 'Choose at least one role.' }],
        },
      }),
    );
    renderButton(update);

    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Reviewer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    expect(await within(dialog).findByRole('group', { name: 'Roles' })).toHaveAccessibleDescription(
      'Choose at least one role.',
    );
  });

  it('explains instead of offering a change when the user holds a role the operator cannot grant', async () => {
    const update = vi.fn<Update>();
    renderButton(
      update,
      [{ id: ROLE_IDS.admin, name: 'Admin', builtin: true, grantable: false }, ...ROLES.slice(1)],
      [ROLE_IDS.admin],
    );

    const dialog = await openDialog();

    expect(dialog).toHaveTextContent(
      'You cannot change the roles of Synthetic Reviewer: Admin includes permissions you do not hold.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Save roles' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels without saving', async () => {
    const update = vi.fn<Update>();
    renderButton(update);

    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('UserRolesButton: where each role applies (C167.2)', () => {
  it('asks where each role applies, offering only the scopes the API would grant, with the reason for the rest', async () => {
    const update = vi.fn<Update>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <UserRolesButton
          userId={USER_IDS.reviewer}
          userLabel="Synthetic Reviewer"
          roles={ROLES}
          currentRoleIds={[ROLE_IDS.reviewer]}
          action={update}
          scopes={{
            [ROLE_IDS.admin]: [
              { value: 'all', label: 'Every environment, current and future', refusal: null },
              {
                value: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51',
                label: 'Sandbox only',
                refusal: 'The built-in admin role is granted organisation-wide only.',
              },
            ],
            [ROLE_IDS.reviewer]: [
              { value: 'all', label: 'Every environment, current and future', refusal: null },
              { value: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', label: 'Sandbox only', refusal: null },
            ],
          }}
        />
      </ToastProvider>,
    );

    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(
      'The environments of the current assignments are not shown here yet: choose them again when you save.',
    );
    const adminScope = within(dialog).getByRole('combobox', { name: 'Where Admin applies' });
    const sandbox = within(adminScope).getByRole('option', {
      name: 'Sandbox only (The built-in admin role is granted organisation-wide only.)',
    });
    expect(sandbox).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Where Reviewer applies' }),
      'Sandbox only',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    expect(update.mock.calls[0]?.[1].get(`scope-${ROLE_IDS.reviewer}`)).toBe(
      'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51',
    );
  });
});

describe('UserRolesButton: the current assignments (K9-22, DS8)', () => {
  type Read = NonNullable<Parameters<typeof UserRolesButton>[0]['readAssignments']>;
  const SANDBOX = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';
  const PRODUCTION = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52';
  const scopeOptions = [
    { value: 'all', label: 'Every environment, current and future', refusal: null },
    { value: SANDBOX, label: 'Sandbox only', refusal: null },
    { value: PRODUCTION, label: 'Production only', refusal: null },
  ];

  function renderReading(read: Read, current: readonly string[]) {
    const update = vi.fn<Update>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <UserRolesButton
          userId={USER_IDS.reviewer}
          userLabel="Synthetic Reviewer"
          roles={ROLES}
          currentRoleIds={current}
          action={update}
          scopes={{
            [ROLE_IDS.admin]: scopeOptions,
            [ROLE_IDS.reviewer]: scopeOptions,
            [ROLE_IDS.viewer]: scopeOptions,
          }}
          readAssignments={read}
        />
      </ToastProvider>,
    );
    return update;
  }

  it('starts each role where it applies today, read when the dialog opens', async () => {
    const read = vi.fn<Read>(() =>
      Promise.resolve({
        ok: true,
        data: [
          { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SANDBOX] },
          { 'role-id': ROLE_IDS.viewer, 'environment-ids': null },
        ],
      }),
    );
    const update = renderReading(read, [ROLE_IDS.reviewer, ROLE_IDS.viewer]);

    const dialog = await openDialog();

    expect(read).toHaveBeenCalledWith(USER_IDS.reviewer);
    expect(
      await within(dialog).findByRole('combobox', { name: 'Where Reviewer applies' }),
    ).toHaveValue(SANDBOX);
    expect(within(dialog).getByRole('combobox', { name: 'Where Viewer applies' })).toHaveValue(
      'all',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Where Admin applies' })).toHaveValue('');
    expect(dialog).toHaveTextContent('Each role starts where it applies today.');
    expect(dialog).not.toHaveTextContent('are not shown here yet');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));
    const posted = update.mock.calls[0]?.[1];
    expect(posted?.get(`scope-${ROLE_IDS.reviewer}`)).toBe(SANDBOX);
    expect(posted?.get(`scope-${ROLE_IDS.viewer}`)).toBe('all');
  });

  it('says so when a role applies in several environments, which one choice cannot say', async () => {
    const read = vi.fn<Read>(() =>
      Promise.resolve({
        ok: true,
        data: [{ 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SANDBOX, PRODUCTION] }],
      }),
    );
    renderReading(read, [ROLE_IDS.reviewer]);

    const dialog = await openDialog();

    expect(
      await within(dialog).findByRole('combobox', { name: 'Where Reviewer applies' }),
    ).toHaveValue('');
    expect(dialog).toHaveTextContent(
      'Reviewer applies today in several environments, which one choice cannot say: choose where it applies.',
    );
  });

  it('says the current environments could not be read, and still lets the operator choose them', async () => {
    const read = vi.fn<Read>(() =>
      Promise.resolve({ ok: false, problem: { title: 'The API could not be reached' } }),
    );
    renderReading(read, [ROLE_IDS.reviewer]);

    const dialog = await openDialog();

    expect(
      await within(dialog).findByText(
        'The environments of the current assignments could not be read: choose them again when you save.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('combobox', { name: 'Where Reviewer applies' })).toHaveValue(
      '',
    );
  });
});
