import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { FieldsEditor } from './fields-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ID = 'acc_01JB0000000000000000000001';

function renderEditor(action: Action) {
  render(
    <ToastProvider>
      <FieldsEditor
        fields={{ name_first: 'Synthetic', age: 42 }}
        hiddenFields={{ 'account-id': ID }}
        description="Fields you send are merged; null clears one."
        action={action}
      />
    </ToastProvider>,
  );
}

describe('FieldsEditor', () => {
  it('edits the fields as JSON and saves them', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    renderEditor(action);

    await userEvent.click(screen.getByRole('button', { name: 'Edit fields' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit fields' });
    const editor = within(dialog).getByRole('textbox', { name: 'Fields' });
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual({
      name_first: 'Synthetic',
      age: 42,
    });
    fireEvent.change(editor, { target: { value: '{ "age": null }' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save fields' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('account-id')).toBe(ID);
    expect(sent?.get('fields')).toBe('{ "age": null }');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved the fields.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("shows the API's errors in the editor by path", async () => {
    renderEditor(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          detail: 'Some fields do not match the account type.',
          errors: [
            {
              pointer: '/data/attributes/fields/age',
              detail: 'is not a field of this account type',
            },
            { pointer: '/data/attributes/status', detail: 'unrelated' },
          ],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit fields' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save fields' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit fields' });
    const problems = await within(dialog).findByRole('list', { name: 'Problems in Fields' });
    expect(problems).toHaveTextContent('/age: is not a field of this account type');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Some fields do not match the account type.',
    );
  });

  it('closes without saving', async () => {
    const action = vi.fn<Action>();
    renderEditor(action);
    await userEvent.click(screen.getByRole('button', { name: 'Edit fields' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
