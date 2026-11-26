import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { SimulateForm, simulateActionsFor } from './simulate-form';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ID = 'inq_01JB0000000000000000000001';

describe('simulateActionsFor', () => {
  it.each([
    ['created', ['start_inquiry', 'expire_inquiry']],
    ['pending', ['complete_inquiry', 'fail_inquiry', 'expire_inquiry']],
    ['completed', ['approve_inquiry', 'decline_inquiry', 'mark_for_review_inquiry']],
    ['needs_review', ['approve_inquiry', 'decline_inquiry']],
    ['approved', []],
  ] as const)('offers the transitions C10 allows from %s', (status, actions) => {
    expect(simulateActionsFor(status)).toEqual(actions);
  });
});

describe('SimulateForm', () => {
  it('runs the chosen simulate action', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <SimulateForm
          inquiryId={ID}
          actions={['complete_inquiry', 'fail_inquiry']}
          action={action}
        />
      </ToastProvider>,
    );

    const select = screen.getByRole('combobox', { name: 'Simulated action' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Complete', 'Fail']);
    await userEvent.selectOptions(select, 'fail_inquiry');
    await userEvent.click(screen.getByRole('button', { name: 'Run in the sandbox' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(ID);
    expect(sent?.get('type')).toBe('fail_inquiry');
    expect(await screen.findByRole('status')).toHaveTextContent('The simulated action ran.');
  });

  it("shows the API's refusal", async () => {
    render(
      <ToastProvider>
        <SimulateForm
          inquiryId={ID}
          actions={['start_inquiry']}
          action={() =>
            Promise.resolve({
              ok: false,
              problem: { title: 'Conflict', detail: 'The inquiry cannot do that now.' },
            })
          }
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run in the sandbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The inquiry cannot do that now.');
  });
});
