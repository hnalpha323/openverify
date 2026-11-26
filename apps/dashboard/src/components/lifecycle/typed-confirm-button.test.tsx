import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { TypedConfirmButton } from './typed-confirm-button';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const INQUIRY = 'inq_01JB0000000000000000000001';

function renderButton(action: Action) {
  render(
    <ToastProvider>
      <TypedConfirmButton
        label="Redact"
        title="Redact this inquiry?"
        description="Its personal data and files are deleted for good."
        phrase="redact"
        confirmLabel="Redact inquiry"
        pendingLabel="Redacting…"
        action={action}
        fields={{ 'inquiry-id': INQUIRY }}
        successMessage="The inquiry was redacted."
      />
    </ToastProvider>,
  );
}

const confirmation = () => screen.getByRole('textbox', { name: 'Type redact to confirm' });

describe('TypedConfirmButton', () => {
  it('asks for the phrase before the confirm button works', async () => {
    const action = vi.fn<Action>();
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    expect(screen.getByRole('dialog', { name: 'Redact this inquiry?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Redact inquiry' })).toBeDisabled();
    await userEvent.type(confirmation(), 'redac');
    expect(screen.getByRole('button', { name: 'Redact inquiry' })).toBeDisabled();
    expect(action).not.toHaveBeenCalled();
  });

  it('runs the action with its fields and the phrase, then closes with a toast', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    renderButton(action);
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));

    await userEvent.type(confirmation(), 'redact');
    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The inquiry was redacted.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(INQUIRY);
    expect(sent?.get('confirmation')).toBe('redact');
  });

  it('keeps the dialog open with the problem when the action fails', async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'Service Unavailable', detail: 'The redaction did not finish.' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Redact' }));
    await userEvent.type(confirmation(), 'redact');

    await userEvent.click(screen.getByRole('button', { name: 'Redact inquiry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The redaction did not finish.');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes on Escape, forgets what was typed and returns focus', async () => {
    renderButton(vi.fn<Action>());
    const trigger = screen.getByRole('button', { name: 'Redact' });
    await userEvent.click(trigger);
    await userEvent.type(confirmation(), 'redact');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    expect(confirmation()).toHaveValue('');
  });
});
