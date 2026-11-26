import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { NewExportForm, type NewExportFormProps } from './new-export-form';

const ENV = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

function show(props: Partial<NewExportFormProps> = {}) {
  const action = vi.fn().mockResolvedValue({ ok: true, data: { id: 'exp_x' } });
  render(
    <ToastProvider>
      <NewExportForm
        environmentId={ENV}
        types={['inquiries', 'verifications', 'lists']}
        canIncludePersonalData
        action={action}
        {...props}
      />
    </ToastProvider>,
  );
  return action;
}

describe('the new-export form (C166.1, C166.2)', () => {
  it('offers only the types held, and the filters each type takes', async () => {
    const user = userEvent.setup();
    show();
    const type = screen.getByLabelText('Export');
    expect(
      within(type)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Inquiries', 'Verifications', 'List items']);
    expect(screen.getByLabelText('Status')).toBeVisible();
    expect(screen.getByLabelText('Created from (UTC)')).toBeVisible();

    await user.selectOptions(type, 'verifications');
    expect(screen.getByLabelText('Verification type')).toBeRequired();

    await user.selectOptions(type, 'lists');
    expect(screen.getByLabelText('List ID')).toBeRequired();
    expect(screen.queryByLabelText('Created from (UTC)')).toBeNull();
  });

  it('asks for a confirmation before including personal data', async () => {
    const user = userEvent.setup();
    const action = show();

    await user.click(screen.getByLabelText(/Include personal data/));
    await user.click(screen.getByRole('button', { name: 'Export' }));

    const dialog = screen.getByRole('dialog', { name: 'Include personal data in the export?' });
    expect(dialog).toHaveTextContent(/stays in the file until it is deleted, at most 24 hours/);
    expect(action).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Export with personal data' }));
    const sent = action.mock.calls[0]?.[1] as FormData;
    expect(sent.get('personal-data-confirmed')).toBe('true');
    expect(sent.get('include-personal-data')).toBe('on');
  });

  it('says personal columns are masked without pii:view', () => {
    show({ canIncludePersonalData: false });

    expect(screen.queryByLabelText(/Include personal data/)).toBeNull();
    expect(
      screen.getByText(/Personal columns are masked: including them needs pii:view/),
    ).toBeVisible();
  });

  it('exports a saved view chosen on its list page by its id', async () => {
    const user = userEvent.setup();
    const action = show({
      savedView: {
        id: 'svw_01JF0000000000000000000008',
        name: 'Failed this month',
        type: 'inquiries',
      },
    });

    expect(screen.getByText(/the filters of your saved view “Failed this month”/)).toBeVisible();
    expect(screen.queryByLabelText('Status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect((action.mock.calls[0]?.[1] as FormData).get('saved-view-id')).toBe(
      'svw_01JF0000000000000000000008',
    );
    expect(
      await screen.findByText('Asked for export exp_x. It appears in your exports once written.'),
    ).toBeVisible();
  });
});
