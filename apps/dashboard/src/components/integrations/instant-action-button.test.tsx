import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { InstantActionButton } from './instant-action-button';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function renderButton(action: Action) {
  render(
    <ToastProvider>
      <InstantActionButton
        label="Enable"
        pendingLabel="Enabling…"
        action={action}
        fields={{ 'webhook-id': 'wbh_1' }}
        successMessage="The webhook is enabled."
      />
    </ToastProvider>,
  );
}

describe('InstantActionButton', () => {
  it('runs the action with its fields and confirms with a toast', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The webhook is enabled.');
    expect(action.mock.calls[0]?.[1].get('webhook-id')).toBe('wbh_1');
  });

  it('shows the problem next to the button when the action fails', async () => {
    renderButton(() =>
      Promise.resolve({ ok: false, problem: { title: 'Invalid Transition', detail: 'No.' } }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Transition');
  });
});
