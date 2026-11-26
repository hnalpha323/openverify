import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import { ConfirmActionButton } from './confirm-action-button';
import { ToastProvider } from './toasts';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const INQUIRY = 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

function renderButton(action: Action, onSuccess = vi.fn()) {
  render(
    <ToastProvider>
      <ConfirmActionButton
        label="Redact"
        title="Redact this inquiry?"
        description="Its personal data and files are deleted. This cannot be undone."
        confirmLabel="Redact inquiry"
        pendingLabel="Redacting…"
        action={action}
        fields={{ 'inquiry-id': INQUIRY }}
        successMessage="The inquiry was redacted."
        onSuccess={onSuccess}
      />
    </ToastProvider>,
  );
  return onSuccess;
}

describe('ConfirmActionButton', () => {
  it('asks before running the action', async () => {
    const action = vi.fn<Action>();
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    expect(screen.getByRole('dialog', { name: 'Redact this inquiry?' })).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });

  it('cancels without running it, and focus returns to the button', async () => {
    const action = vi.fn<Action>();
    renderButton(action);
    const trigger = screen.getByRole('button', { name: 'Redact' });
    await userEvent.click(trigger);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('runs the server action with its fields, closes, and confirms with a toast', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    const onSuccess = renderButton(action);
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was redacted.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action.mock.calls[0]?.[1].get('inquiry-id')).toBe(INQUIRY);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps the dialog open with the problem when the action fails', async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'Invalid Transition', detail: 'The inquiry is already redacted.' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));

    const dialog = screen.getByRole('dialog');
    expect(await screen.findByRole('alert')).toHaveTextContent('The inquiry is already redacted.');
    expect(dialog).toContainElement(screen.getByRole('alert'));
  });

  it('starts clean when opened again after a failure', async () => {
    renderButton(() => Promise.resolve({ ok: false, problem: { title: 'Refused' } }));
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));
    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
