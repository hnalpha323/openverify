import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASE_IDS } from '../../testing/cases-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { QueueMembersEditor } from './queue-members-editor';

/** The `index`th of `items`, or a failure naming it. */
function nth(items: readonly HTMLElement[], index: number): HTMLElement {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item ${String(index)}`);
  }
  return item;
}

const MEMBERS = [
  { 'user-id': CASE_IDS.user, 'max-open': 50, paused: false },
  { 'user-id': CASE_IDS.member, 'max-open': 10, paused: true },
];

function setup(answer: ActionResult = { ok: true, data: undefined }) {
  const action = vi.fn<(state: ActionState, data: FormData) => Promise<ActionResult>>(() =>
    later(answer),
  );
  render(
    <ToastProvider>
      <QueueMembersEditor
        queueId={CASE_IDS.queue}
        members={MEMBERS}
        directory={[]}
        action={action}
      />
    </ToastProvider>,
  );
  return action;
}

describe('the queue members editor (C132.1, C142.1)', () => {
  it('adds and removes members by keyboard and posts every row with its capacity and pause', async () => {
    const user = userEvent.setup();
    const action = setup();
    const editor = screen.getByRole('form', { name: 'Edit the members' });

    await user.click(within(editor).getByRole('button', { name: 'Add a member' }));
    const third = within(nth(within(editor).getAllByRole('group'), 2));
    expect(third.getByRole('textbox', { name: /^Member 3/u })).toHaveFocus();
    await user.keyboard('usr_01JE0000000000000000000009');
    await user.clear(third.getByRole('spinbutton', { name: /^Open cases at most/u }));
    await user.type(third.getByRole('spinbutton', { name: /^Open cases at most/u }), '5');
    await user.click(
      within(nth(within(editor).getAllByRole('group'), 0)).getByRole('button', {
        name: `Remove ${CASE_IDS.user}`,
      }),
    );
    expect(screen.getByRole('status', { name: 'Members' })).toHaveTextContent(
      `Removed ${CASE_IDS.user}. 2 members.`,
    );
    await user.click(within(editor).getByRole('button', { name: 'Save members' }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    const data = action.mock.calls[0]?.[1] ?? new FormData();
    expect(data.get('case-queue-id')).toBe(CASE_IDS.queue);
    expect(data.getAll('member-user-id')).toEqual([
      CASE_IDS.member,
      'usr_01JE0000000000000000000009',
    ]);
    expect(data.getAll('member-max-open')).toEqual(['10', '5']);
    expect(data.getAll('member-paused')).toEqual(['true', 'false']);
    expect(await screen.findByText('Saved the members.')).toBeVisible();
  });

  it('shows a refusal at the member it names', async () => {
    const user = userEvent.setup();
    setup({
      ok: false,
      problem: {
        title: 'That person cannot take the case',
        errors: [{ pointer: '/data/attributes/members/1/user-id', detail: 'Not eligible.' }],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Save members' }));

    const second = within(
      nth(within(screen.getByRole('form', { name: 'Edit the members' })).getAllByRole('group'), 1),
    );
    expect(await second.findByText('Not eligible.')).toBeVisible();
    expect(second.getByRole('textbox', { name: /^Member 2/u })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
