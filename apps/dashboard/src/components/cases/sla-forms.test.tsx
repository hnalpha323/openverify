import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASE_IDS } from '../../testing/cases-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { HolidayImportForm, type HolidayImportResult } from './sla-forms';

describe('the holiday import (C133.2, C142.1)', () => {
  it('says how many holidays were taken and each refused row by number in words, never its value', async () => {
    const user = userEvent.setup();
    const action = vi.fn<
      (
        state: ActionState<HolidayImportResult>,
        data: FormData,
      ) => Promise<ActionResult<HolidayImportResult>>
    >(() =>
      later({
        ok: true,
        data: {
          imported: 2,
          refused: [
            { row: 3, code: 'invalid_value' },
            { row: 5, code: 'date_repeated' },
            { row: 7, code: 'field_count_mismatch' },
          ],
        },
      }),
    );
    render(
      <ToastProvider>
        <HolidayImportForm calendarId={CASE_IDS.calendar} action={action} />
      </ToastProvider>,
    );
    const csv = 'date,label\n2027-01-01,Synthetic day\n2027-13-01,Synthetic secret label\n';
    const importForm = screen.getByRole('form', { name: 'Import holidays' });

    await user.upload(
      within(importForm).getByLabelText(/^CSV file/u),
      new File([csv], 'holidays.csv', { type: 'text/csv' }),
    );
    await user.click(within(importForm).getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const result = await screen.findByRole('status', { name: 'Import result' });
    expect(result).toHaveTextContent('Imported 2 holidays. 3 rows were refused.');
    const refused = within(result).getByRole('list', { name: 'Refused rows' });
    expect(
      within(refused)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Row 3: the date or the label is not valid (a real date, YYYY-MM-DD, and a label of 1 to 80 characters).',
      'Row 5: the date is already in this file.',
      'Row 7: the row has more or fewer cells than the header.',
    ]);
    expect(document.body).not.toHaveTextContent('Synthetic secret label');
    expect(action.mock.calls[0]?.[1].get('case-calendar-id')).toBe(CASE_IDS.calendar);
  });
});
