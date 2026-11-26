import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { REPORT_CONFIG_IDS as IDS } from '../../testing/report-config-fixtures';
import { ToastProvider } from '../toasts';
import { NewReportDraftButton } from './new-draft-button';

type Action = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

function renderButton(action: Action) {
  render(
    <ToastProvider>
      <NewReportDraftButton templateId={IDS.template} action={action} />
    </ToastProvider>,
  );
}

describe('NewReportDraftButton (C71.1)', () => {
  it('drafts a new version of the template', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: { path: '/elsewhere' } }));
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'New draft' }));

    expect(action.mock.calls[0]?.[1].get('report-template-id')).toBe(IDS.template);
  });

  it('shows a refusal as a toast', async () => {
    renderButton(() =>
      later({ ok: false, problem: { title: 'You do not have access', detail: 'Ask an admin.' } }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'New draft' }));

    expect(await screen.findByText('You do not have access: Ask an admin.')).toBeVisible();
  });
});
