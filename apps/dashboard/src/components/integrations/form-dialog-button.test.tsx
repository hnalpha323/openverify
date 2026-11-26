import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { FormDialogButton } from './form-dialog-button';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function renderButton(action: Action, onSuccess = vi.fn()) {
  render(
    <ToastProvider>
      <FormDialogButton
        label="Edit"
        title="Edit the API key"
        description="Rename it, or change where it may be used from."
        submitLabel="Save changes"
        pendingLabel="Saving…"
        action={action}
        fields={{ 'api-key-id': 'key_1' }}
        successMessage="The API key was saved."
        onSuccess={onSuccess}
      >
        {(problem) => (
          <label>
            Name
            <input name="name" defaultValue="CI" aria-invalid={problem !== undefined} />
          </label>
        )}
      </FormDialogButton>
    </ToastProvider>,
  );
  return onSuccess;
}

describe('FormDialogButton', () => {
  it('opens a form in a dialog, runs the action and closes with a toast', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    const onSuccess = renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit the API key' });
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Deploys');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The API key was saved.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('api-key-id')).toBe('key_1');
    expect(sent?.get('name')).toBe('Deploys');
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps what the operator typed and shows the problem when the action fails', async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'Check the values you entered', detail: 'Some values are not valid.' },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.type(name, ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('CI 2');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('closes on Cancel without running the action', async () => {
    const action = vi.fn<Action>();
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });
});
