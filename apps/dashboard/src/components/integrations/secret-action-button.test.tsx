import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { SecretActionButton } from './secret-action-button';

interface Rotated {
  readonly secret: string;
  readonly until: string;
}

type Action = (state: ActionState<Rotated>, formData: FormData) => Promise<ActionResult<Rotated>>;

const SECRET = `wbhsec_${'s'.repeat(43)}`;

function renderButton(action: Action, onClosed = vi.fn()) {
  render(
    <ToastProvider>
      <SecretActionButton
        label="Rotate secret"
        title="Rotate the signing secret?"
        description="Deliveries are signed with a new secret."
        confirmLabel="Rotate"
        pendingLabel="Rotating…"
        tone="primary"
        action={action}
        fields={{ 'webhook-id': 'wbh_1' }}
        secretTitle="New signing secret"
        secretLabel="Signing secret"
        secretDescription={(data) => `The previous secret signs until ${data.until}.`}
        onClosed={onClosed}
      >
        <label>
          Overlap
          <input name="overlap" defaultValue="60" />
        </label>
      </SecretActionButton>
    </ToastProvider>,
  );
  return onClosed;
}

describe('SecretActionButton', () => {
  it('asks first, runs the action, then shows the secret once', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({ ok: true, data: { secret: SECRET, until: 'tomorrow' } }),
    );
    const onClosed = renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    const confirm = screen.getByRole('dialog', { name: 'Rotate the signing secret?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Rotate' }));

    const form = action.mock.calls[0]?.[1];
    expect(form?.get('webhook-id')).toBe('wbh_1');
    expect(form?.get('overlap')).toBe('60');
    const reveal = await screen.findByRole('dialog', { name: 'New signing secret' });
    expect(within(reveal).getByRole('textbox', { name: 'Signing secret' })).toHaveValue(SECRET);
    expect(reveal).toHaveTextContent('The previous secret signs until tomorrow.');

    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(onClosed).toHaveBeenCalledExactlyOnceWith({ until: 'tomorrow' });
    expect(screen.getByRole('button', { name: 'Rotate secret' })).toHaveFocus();
  });

  it('keeps the question open with the problem when the action fails', async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'Invalid Transition', detail: 'The webhook is archived.' },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));

    const confirm = screen.getByRole('dialog', { name: 'Rotate the signing secret?' });
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('The webhook is archived.');

    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('works without the optional parts, with the default description', async () => {
    render(
      <ToastProvider>
        <SecretActionButton
          label="Clone"
          title="Clone this webhook?"
          confirmLabel="Clone webhook"
          action={() => Promise.resolve({ ok: true, data: { secret: SECRET } })}
          secretTitle="Webhook cloned"
          secretLabel="Signing secret"
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clone webhook' }));
    const reveal = await screen.findByRole('dialog', { name: 'Webhook cloned' });
    expect(reveal).toHaveTextContent('This is the only time it is shown.');

    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
