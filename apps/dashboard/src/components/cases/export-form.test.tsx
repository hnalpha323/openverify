import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { CASE_IDS } from '../../testing/cases-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { ExportForm } from './export-form';

type Action = (
  state: ActionState<{ id: string }>,
  data: FormData,
) => Promise<ActionResult<{ id: string }>>;

function setup(canIncludePersonalData = true) {
  const action = vi.fn<Action>(() => later({ ok: true, data: { id: CASE_IDS.export } }));
  render(
    <ToastProvider>
      <ExportForm
        environmentId={ENVIRONMENTS.sandbox.id}
        canIncludePersonalData={canIncludePersonalData}
        templates={[{ id: CASE_IDS.template, name: 'Synthetic KYC review' }]}
        queues={[{ id: CASE_IDS.queue, name: 'Synthetic first line' }]}
        action={action}
      />
    </ToastProvider>,
  );
  return action;
}

describe('the case export form (C138.1, C142.1)', () => {
  it('asks without personal data at once, saying the file lives 24 hours', async () => {
    const user = userEvent.setup();
    const action = setup();
    const form = screen.getByRole('form', { name: 'Export cases' });
    expect(form).toHaveTextContent('24 hours');

    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Template' }),
      CASE_IDS.template,
    );
    await user.click(within(form).getByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const data = action.mock.calls[0]?.[1] ?? new FormData();
    expect(data.get('format')).toBe('csv');
    expect(data.get('template')).toBe(CASE_IDS.template);
    expect(data.get('include-personal-data')).toBeNull();
    expect(
      await screen.findByText('Asked for the export. It appears below once written.'),
    ).toBeVisible();
  });

  it('asks for a confirmation before including personal data, and sends nothing on cancel', async () => {
    const user = userEvent.setup();
    const action = setup();
    const form = screen.getByRole('form', { name: 'Export cases' });

    await user.click(within(form).getByRole('checkbox', { name: /^Include personal data/u }));
    await user.click(within(form).getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Include personal data in the export?' });
    expect(dialog).toHaveTextContent(/fields/u);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(action).not.toHaveBeenCalled();

    await user.click(within(form).getByRole('button', { name: 'Export' }));
    await user.click(
      within(
        screen.getByRole('dialog', { name: 'Include personal data in the export?' }),
      ).getByRole('button', { name: 'Export with personal data' }),
    );

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const data = action.mock.calls[0]?.[1] ?? new FormData();
    expect(data.get('include-personal-data')).toBe('on');
    expect(data.get('personal-data-confirmed')).toBe('true');
  });
});
