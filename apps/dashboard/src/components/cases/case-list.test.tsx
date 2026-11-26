import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { CASE_IDS, CT0, CT2 } from '../../testing/cases-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { CaseList, NextCaseButton, type CaseRow } from './case-list';

const push = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const COLUMNS_KEY = 'openverify:case-list-columns';

const row = (id: string, name: string): CaseRow => ({
  id,
  name,
  status: 'open',
  category: 'initial',
  resolution: null,
  template: 'Synthetic KYC review',
  queue: 'Synthetic first line',
  assignee: null,
  slaState: 'running',
  slaExpiresAt: CT2,
  createdAt: CT0,
  tags: ['synthetic'],
  redacted: false,
});

const ROWS = [row(CASE_IDS.case, 'KYC-6'), row(CASE_IDS.otherCase, 'KYC-7')];

type BulkAction = (
  state: ActionState<{ id: string }>,
  data: FormData,
) => Promise<ActionResult<{ id: string }>>;

function setup(options: { canAssign?: boolean; bulk?: boolean } = {}) {
  const action = vi.fn<BulkAction>(() => later({ ok: true, data: { id: CASE_IDS.bulk } }));
  render(
    <ToastProvider>
      <CaseList
        rows={ROWS}
        emptyMessage="No cases."
        bulk={
          options.bulk === false
            ? null
            : {
                canAssign: options.canAssign ?? true,
                userId: CASE_IDS.user,
                queues: [{ id: CASE_IDS.queue, name: 'Synthetic first line' }],
                action,
              }
        }
      />
    </ToastProvider>,
  );
  return action;
}

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the case list’s columns (C142.1)', () => {
  it('hides a column when unticked, and keeps the choice in this browser only', async () => {
    const user = userEvent.setup();
    setup({ bulk: false });
    const table = screen.getByRole('table', { name: 'Cases' });
    expect(within(table).getByRole('columnheader', { name: 'Tags' })).toBeVisible();

    await user.click(screen.getByText('Columns'));
    await user.click(screen.getByRole('checkbox', { name: 'Tags' }));

    expect(within(table).queryByRole('columnheader', { name: 'Tags' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? '[]')).not.toContain('tags');
    expect(screen.getByRole('checkbox', { name: 'Name' })).toBeDisabled();
  });

  it('starts from the columns kept in this browser, and ignores a value it cannot read', () => {
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(['status', 'queue']));
    setup({ bulk: false });

    const headers = within(screen.getByRole('table', { name: 'Cases' }))
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Name', 'Status', 'Queue']);
  });

  it('shows every column when the kept value is not a list', () => {
    window.localStorage.setItem(COLUMNS_KEY, '{oops');
    setup({ bulk: false });

    expect(
      within(screen.getByRole('table', { name: 'Cases' })).getByRole('columnheader', {
        name: 'SLA',
      }),
    ).toBeVisible();
  });
});

describe('the case list’s bulk actions (C137.4, C142.1)', () => {
  it('sets the status of the selected cases, then opens the action’s outcomes', async () => {
    const user = userEvent.setup();
    const action = setup();
    const form = screen.getByRole('form', { name: 'Act on the selected cases' });
    expect(within(form).getByRole('button', { name: 'Apply…' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select KYC-6' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select KYC-7' }));
    expect(within(form).getByText('2 cases selected')).toBeVisible();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Action' }), 'set-status');
    await user.type(within(form).getByRole('textbox', { name: /^Status key/u }), 'approved');
    await user.type(within(form).getByRole('textbox', { name: /^Resolution/u }), 'Approved');
    await user.click(within(form).getByRole('button', { name: 'Apply…' }));
    const dialog = screen.getByRole('dialog', { name: 'Set the status of 2 cases?' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/cases/bulk/${CASE_IDS.bulk}`);
    });
    const data = action.mock.calls[0]?.[1] ?? new FormData();
    expect(data.get('action')).toBe('set-status');
    expect(data.getAll('case-id')).toEqual([CASE_IDS.case, CASE_IDS.otherCase]);
    expect(data.get('status')).toBe('approved');
    expect(data.get('resolution')).toBe('Approved');
  });

  it('offers assignment only with cases:assign, to oneself or an operator id', async () => {
    const user = userEvent.setup();
    setup({ canAssign: false });
    const form = screen.getByRole('form', { name: 'Act on the selected cases' });
    const actions = within(within(form).getByRole('combobox', { name: 'Action' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(actions).toEqual(['Set the status', 'Move to a queue', 'Add tags', 'Remove tags']);

    await user.selectOptions(within(form).getByRole('combobox', { name: 'Action' }), 'set-queue');
    expect(within(form).getByRole('combobox', { name: 'Queue' })).toHaveValue('');
    expect(within(form).getByRole('option', { name: 'No queue' })).toBeInTheDocument();
  });

  it('shows a refusal of the whole action in its dialog', async () => {
    const user = userEvent.setup();
    const action = setup();
    action.mockImplementation(() =>
      later({
        ok: false,
        problem: { title: 'A bulk action takes at most 500 cases: narrow the selection.' },
      }),
    );
    const form = screen.getByRole('form', { name: 'Act on the selected cases' });

    await user.click(screen.getByRole('checkbox', { name: 'Select KYC-6' }));
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Action' }), 'add-tags');
    await user.type(within(form).getByRole('textbox', { name: /^Tags/u }), 'urgent');
    await user.click(within(form).getByRole('button', { name: 'Apply…' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add tags to 1 case?' })).getByRole('button', {
        name: 'Apply',
      }),
    );

    expect(
      await screen.findByText('A bulk action takes at most 500 cases: narrow the selection.'),
    ).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('next case (C132.3, C142.1)', () => {
  it('opens the case it pulled, or says that none is waiting', async () => {
    const user = userEvent.setup();
    const take = vi
      .fn<
        (
          state: ActionState<{ caseId: string | null }>,
          data: FormData,
        ) => Promise<ActionResult<{ caseId: string | null }>>
      >()
      .mockImplementationOnce(() => later({ ok: true, data: { caseId: null } }))
      .mockImplementationOnce(() => later({ ok: true, data: { caseId: CASE_IDS.case } }));
    render(
      <ToastProvider>
        <NextCaseButton action={take} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Next case' }));
    expect(await screen.findByText('No case is waiting in your queues.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Next case' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/cases/${CASE_IDS.case}`);
    });
  });
});

describe('next case from one queue (C132.3, C142.1)', () => {
  it('pulls from the queue the list is filtered by, when it is', async () => {
    const user = userEvent.setup();
    const take = vi.fn<
      (
        state: ActionState<{ caseId: string | null }>,
        data: FormData,
      ) => Promise<ActionResult<{ caseId: string | null }>>
    >(() => later({ ok: true, data: { caseId: null } }));
    render(
      <ToastProvider>
        <NextCaseButton action={take} queueId={CASE_IDS.queue} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Next case from this queue' }));

    await waitFor(() => {
      expect(take).toHaveBeenCalledTimes(1);
    });
    expect(take.mock.calls[0]?.[1].getAll('case-queue-id')).toEqual([CASE_IDS.queue]);
    expect(await screen.findByText('No case is waiting in this queue.')).toBeVisible();
  });
});
