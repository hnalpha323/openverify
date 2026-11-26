/**
 * C172.2, C172.7: a case's checklists, each item with who checked it and when; an operator checks
 * or unchecks an item only by pressing its own button, and a reader without `cases:write` sees the
 * state with nothing to press.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { later } from '../../../testing/later';
import { REVIEWER_IDS as IDS } from '../../../testing/reviewer-fixtures';
import { CHECKED_AT, checklistState } from '../../../testing/routes/cases-reports';
import { ToastProvider } from '../../toasts';
import { CaseChecklists } from './case-checklists';
import { checklistViews, itemsBlocking } from './checklist-model';

const CHECKLISTS = [
  {
    key: 'kyc',
    label: 'Identity review',
    items: [
      { key: 'id-seen', label: 'Document seen', 'required-for-statuses': ['approved'] },
      { key: 'address-seen', label: 'Address seen', 'required-for-statuses': ['approved'] },
      { key: 'notes', label: 'Notes written', 'required-for-statuses': [] },
    ],
  },
];
const STATE = checklistState([
  { checklist: 'kyc', item: 'id-seen', by: IDS.me },
  { checklist: 'kyc', item: 'address-seen' },
  { checklist: 'kyc', item: 'notes', by: IDS.run },
]);
const LABELS = new Map([
  ['open', 'Open'],
  ['approved', 'Approved'],
]);
const PEOPLE = new Map([[IDS.me, 'reviewer@example.com']]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checklistViews and itemsBlocking', () => {
  it('pairs each item of the version with its state, and names the unchecked items a status needs', () => {
    const views = checklistViews(CHECKLISTS, STATE.data.attributes.items);

    expect(views).toHaveLength(1);
    expect(views[0]?.items.map((item) => [item.itemKey, item.checked, item.checkedBy])).toEqual([
      ['id-seen', true, IDS.me],
      ['address-seen', false, null],
      ['notes', true, IDS.run],
    ]);
    expect(itemsBlocking(views, 'approved').map((item) => item.itemKey)).toEqual(['address-seen']);
    expect(itemsBlocking(views, 'open')).toEqual([]);
  });

  it('reads an item the state does not name as unchecked, never as checked', () => {
    const views = checklistViews(CHECKLISTS, []);

    expect(views[0]?.items.every((item) => !item.checked && item.checkedBy === null)).toBe(true);
  });
});

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const succeed: Action = () => later({ ok: true, data: undefined });
/** The fields the action's first call received. */
const sentOf = (action: { mock: { calls: readonly (readonly unknown[])[] } }) =>
  Object.fromEntries((action.mock.calls[0]?.[1] as FormData).entries());

function show(canWrite: boolean, action = vi.fn(succeed)) {
  render(
    <ToastProvider>
      <CaseChecklists
        caseId={IDS.case}
        lockVersion={3}
        checklists={checklistViews(CHECKLISTS, STATE.data.attributes.items)}
        statusLabels={LABELS}
        people={PEOPLE}
        canWrite={canWrite}
        action={action}
      />
    </ToastProvider>,
  );
  return action;
}

const item = (label: string) => within(screen.getByRole('listitem', { name: label }));

describe('CaseChecklists', () => {
  it('says who checked each item and when, and what an unchecked item is needed before', () => {
    show(true);

    expect(screen.getByRole('group', { name: 'Identity review' })).toBeVisible();
    expect(item('Document seen').getByText(/Checked by reviewer@example\.com/)).toBeVisible();
    expect(item('Document seen').getByText(/Nov 2, 2026/)).toHaveAttribute('dateTime', CHECKED_AT);
    expect(item('Address seen').getByText('Not checked')).toBeVisible();
    expect(item('Address seen').getByText('Needed before: Approved')).toBeVisible();
    expect(item('Notes written').getByText(/Checked by a workflow run/)).toBeVisible();
  });

  it('checks an item only through its own button, sending the item, its new state and the lock version', async () => {
    const user = userEvent.setup();
    const action = show(true);

    await user.click(screen.getByRole('button', { name: 'Check Address seen' }));

    expect(action).toHaveBeenCalledTimes(1);
    const sent = sentOf(action);
    expect(sent).toEqual({
      'case-id': IDS.case,
      'checklist-key': 'kyc',
      'item-key': 'address-seen',
      checked: 'true',
      'lock-version': '3',
    });
    expect(await screen.findByText('The item was checked.')).toBeVisible();
  });

  it('unchecks a checked item', async () => {
    const user = userEvent.setup();
    const action = show(true);

    await user.click(screen.getByRole('button', { name: 'Uncheck Document seen' }));

    const sent = sentOf(action);
    expect(sent.checked).toBe('false');
  });

  it('shows a refusal in words beside the item it was for', async () => {
    const user = userEvent.setup();
    show(
      true,
      vi.fn<Action>(() =>
        later<ActionResult>({
          ok: false,
          problem: {
            title: 'Someone changed this case',
            status: 409,
            code: 'case_version_conflict',
          },
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Check Address seen' }));

    expect(await item('Address seen').findByText('Someone changed this case')).toBeVisible();
  });

  it('offers nothing to press to a reader without cases:write, and says so', () => {
    show(false);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/checking an item needs permission to change cases/)).toBeVisible();
  });
});
