import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { AccountTypeEditForm, AccountTypeForm } from './account-type-form';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { LIFECYCLE_IDS as IDS, accountType } from '../../testing/lifecycle-fixtures';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function renderForm(action: Action) {
  render(
    <ToastProvider>
      <AccountTypeForm action={action} environmentId={ENVIRONMENTS.sandbox.id} />
    </ToastProvider>,
  );
  return screen.getByRole('form', { name: 'New account type' });
}

describe('AccountTypeForm', () => {
  it('sends the name and the fields schema', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    const form = renderForm(action);

    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'business');
    fireEvent.change(within(form).getByRole('textbox', { name: 'Fields schema' }), {
      target: { value: '{ "legal_name": { "type": "string", "label": "Legal name" } }' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Create account type' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('name')).toBe('business');
    expect(sent?.get('fields-schema')).toBe(
      '{ "legal_name": { "type": "string", "label": "Legal name" } }',
    );
    expect(await screen.findByText('Created the account type.')).toBeVisible();
  });

  it('shows the errors by path: the name at its field, the schema in the editor', async () => {
    const form = renderForm(() =>
      later({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            { pointer: '/data/attributes/name', detail: 'must not contain control characters' },
            {
              pointer: '/data/attributes/fields-schema/Legal',
              detail: 'must be a snake_case field key',
            },
          ],
        },
      }),
    );

    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'business');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account type' }));

    // The textbox is there before the answer: wait for the answer's description on it.
    await waitFor(() => {
      expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
        'must not contain control characters',
      );
    });
    expect(within(form).getByRole('list', { name: 'Problems in Fields schema' })).toHaveTextContent(
      '/Legal: must be a snake_case field key',
    );
  });
});

describe('AccountTypeEditForm (C25.3)', () => {
  const SCHEMA = {
    legal_name: { type: 'string', label: 'Legal name' },
    founded: { type: 'date', label: 'Founded on' },
  } as const;
  const TYPE = accountType('business', IDS.otherAccountType, SCHEMA);

  function renderEdit(action: Action, environmentId: string = ENVIRONMENTS.sandbox.id) {
    render(
      <ToastProvider>
        <AccountTypeEditForm action={action} environmentId={environmentId} accountType={TYPE} />
      </ToastProvider>,
    );
    return screen.getByRole('form', { name: 'Edit the account type' });
  }

  it('starts from the type: its name and its whole fields schema, for the environment it was rendered in', () => {
    const form = renderEdit(vi.fn<Action>(), ENVIRONMENTS.production.id);

    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('business');
    expect(within(form).getByRole('textbox', { name: 'Fields schema' })).toHaveValue(
      JSON.stringify(SCHEMA, null, 2),
    );
    const sent = new FormData(form as HTMLFormElement);
    expect(sent.get('account-type-id')).toBe(IDS.otherAccountType);
    expect(sent.get('environment-id')).toBe(ENVIRONMENTS.production.id);
  });

  it('sends the name and the new schema, and says the type was saved', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    const form = renderEdit(action);
    const added = { ...SCHEMA, employees: { type: 'number', label: 'Employees' } };

    fireEvent.change(within(form).getByRole('textbox', { name: 'Fields schema' }), {
      target: { value: JSON.stringify(added) },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved the account type.')).toBeVisible();
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('name')).toBe('business');
    expect(sent?.get('fields-schema')).toBe(JSON.stringify(added));
  });

  it("shows the API's refusal of a removed key at its path in the editor, keeping what was typed", async () => {
    const form = renderEdit(() =>
      later({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          detail: 'An account type change may add fields and change labels only.',
          status: 422,
          errors: [
            {
              pointer: '/data/attributes/fields-schema/founded',
              detail: 'cannot be removed: accounts may hold values for it',
            },
          ],
        },
      }),
    );
    const typed = JSON.stringify({ legal_name: SCHEMA.legal_name });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Fields schema' }), {
      target: { value: typed },
    });

    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(
      await within(form).findByRole('list', { name: 'Problems in Fields schema' }),
    ).toHaveTextContent('/founded: cannot be removed: accounts may hold values for it');
    expect(
      within(form).getByText('An account type change may add fields and change labels only.'),
    ).toBeVisible();
    expect(within(form).getByRole('textbox', { name: 'Fields schema' })).toHaveValue(typed);
  });

  it('shows a refused name at the Name field', async () => {
    const form = renderEdit(() =>
      later({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          errors: [
            {
              pointer: '/data/attributes/name',
              detail: 'the default account type user keeps its name',
            },
          ],
        },
      }),
    );

    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(
      await within(form).findByRole('textbox', {
        name: 'Name',
        description: 'the default account type user keeps its name',
      }),
    ).toBeVisible();
  });
});
