import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { NewDraftButton } from './new-draft-button';
import { LIFECYCLE_IDS as IDS } from '../../testing/lifecycle-fixtures';

type Action = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

function renderButton(action: Action) {
  render(
    <ToastProvider>
      <NewDraftButton templateId={IDS.template} action={action} />
    </ToastProvider>,
  );
}

describe('NewDraftButton', () => {
  it('asks the action for a draft of this template', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({ ok: true, data: { path: `/templates/${IDS.template}/versions/x` } }),
    );
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'New draft' }));

    expect(action.mock.calls[0]?.[1].get('inquiry-template-id')).toBe(IDS.template);
  });

  it('says why the draft was refused', async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'You do not have access', detail: 'Your role does not allow this.' },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'New draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have access: Your role does not allow this.',
    );
  });
});
