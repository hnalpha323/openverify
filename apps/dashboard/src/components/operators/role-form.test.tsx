import { PERMISSIONS } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { RoleForm } from './role-form';
import { ROLE_IDS } from './test-fixtures';

type Save = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/**
 * KP11-66: the form shows 86 permission checkboxes, and jsdom resolves a control's labels by
 * walking the whole document, so `getByLabelText` and a named `getByRole('checkbox')` each took
 * about 0.6 and 1.0 s here, and every case about 2 s of CPU: the all-packages run's
 * oversubscription stretched that past the 60 s guard. These find the same controls through the
 * same associations (a role and its accessible name; a `<label>`'s own control) at a fraction of it.
 */
const nameField = () => screen.getByRole('textbox', { name: 'Name' });

/** A permission's checkbox: the `<label>` with exactly this text, and the control it labels. */
function permission(label: string): HTMLInputElement {
  const control = screen.getByText<HTMLLabelElement>(label, { selector: 'label' });
  if (!(control.control instanceof HTMLInputElement) || control.control.type !== 'checkbox') {
    throw new Error(`The label ${label} labels no checkbox`);
  }
  return control.control;
}

describe('RoleForm', () => {
  it('creates a role from a name and the checked permissions', async () => {
    const save = vi.fn<Save>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Create role"
          pendingLabel="Creating…"
        />
      </ToastProvider>,
    );

    await userEvent.type(nameField(), 'Support');
    await userEvent.click(permission('View inquiries'));
    await userEvent.click(permission('View accounts'));
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));

    const formData = save.mock.calls[0]?.[1];
    expect(formData?.get('name')).toBe('Support');
    expect(formData?.getAll('permissions')).toEqual(['inquiries:read', 'accounts:read']);
    expect(formData?.has('role-id')).toBe(false);
  });

  it('edits a role: its name and permissions are filled in, and saving confirms', async () => {
    const save = vi.fn<Save>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successMessage="The role was saved."
          role={{ id: ROLE_IDS.support, name: 'Support', permissions: ['inquiries:read'] }}
        />
      </ToastProvider>,
    );

    expect(nameField()).toHaveValue('Support');
    expect(permission('View inquiries')).toBeChecked();
    await userEvent.click(permission('Create and change inquiries'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const formData = save.mock.calls[0]?.[1];
    expect(formData?.get('role-id')).toBe(ROLE_IDS.support);
    expect(formData?.getAll('permissions')).toEqual(['inquiries:read', 'inquiries:write']);
    expect(await screen.findByRole('status')).toHaveTextContent('The role was saved.');
  });

  it('shows field errors next to their fields, and other problems above the button', async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          detail: 'Some values are not valid.',
          errors: [
            { pointer: '/data/attributes/name', detail: 'Enter a name.' },
            { pointer: '/data/attributes/permissions', detail: 'Choose at least one permission.' },
          ],
        },
      }),
    );
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Create role"
          pendingLabel="Creating…"
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(nameField()).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByRole('group', { name: 'Permissions' })).toHaveAccessibleDescription(
      'Choose at least one permission.',
    );
  });

  it("shows the API's refusal, such as a name already taken", async () => {
    const save = vi.fn<Save>(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Conflict',
          detail: 'A role with this name already exists.',
          status: 409,
        },
      }),
    );
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Create role"
          pendingLabel="Creating…"
        />
      </ToastProvider>,
    );

    await userEvent.type(nameField(), 'Admin');
    await userEvent.click(permission('View inquiries'));
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A role with this name already exists.',
    );
    // What was entered survives the refusal, so it can be corrected.
    expect(nameField()).toHaveValue('Admin');
    expect(permission('View inquiries')).toBeChecked();
  });
});

describe('RoleForm: removals ask first (C167.4)', () => {
  it('lists what a change removes and from how many users before saving', async () => {
    const save = vi.fn<Save>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          holders={3}
          role={{
            id: ROLE_IDS.support,
            name: 'Support',
            permissions: ['inquiries:read', 'accounts:read'],
          }}
        />
      </ToastProvider>,
    );

    await userEvent.click(permission('View accounts'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove 1 permission from Support?' });
    expect(dialog).toHaveAccessibleDescription(
      '3 users with this role lose it: View accounts (accounts:read).',
    );
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove and save' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves at once when nothing is removed', async () => {
    const save = vi.fn<Save>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <RoleForm
          action={save}
          held={PERMISSIONS}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          holders={null}
          role={{ id: ROLE_IDS.support, name: 'Support', permissions: ['inquiries:read'] }}
        />
      </ToastProvider>,
    );

    await userEvent.click(permission('View accounts'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(save).toHaveBeenCalledTimes(1);
  });
});
