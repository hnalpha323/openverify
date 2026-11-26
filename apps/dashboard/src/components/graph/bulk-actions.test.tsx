import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BulkActionAnswer } from '../../app/graph/actions';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { GRAPH_IDS as IDS } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { BulkActions, type BulkActionsProps } from './bulk-actions';
import { GRAPH_PROBLEM_WORDS } from './graph-words';

type Action = (
  state: ActionState<BulkActionAnswer>,
  formData: FormData,
) => Promise<ActionResult<BulkActionAnswer>>;

const ALL = { tags: true, lists: true, export: true } as const;

function renderPanel(props: Partial<BulkActionsProps> & { readonly action: Action }) {
  return render(
    <ToastProvider>
      <BulkActions
        queryId={IDS.query}
        accountCount={3}
        selected={new Set([IDS.accountA, IDS.accountB])}
        abilities={ALL}
        kinds={['email_address', 'phone_number_unconfirmed']}
        lists={[{ id: IDS.list, name: 'Watched emails', kind: 'email-address' }]}
        {...props}
      />
    </ToastProvider>,
  );
}

const answer = (data: Partial<BulkActionAnswer>): Promise<ActionResult<BulkActionAnswer>> =>
  later({
    ok: true as const,
    data: { action: 'add-tag', preview: true, selectedCount: 2, outcomes: [], ...data },
  });

describe('bulk actions from a graph result (C103, C108)', () => {
  it('offers only the actions the role may take', () => {
    const action = vi.fn<Action>();
    const { unmount } = renderPanel({ action });
    const choices = screen.getByRole('combobox', { name: 'Action' });
    expect(
      within(choices)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Add a tag',
      'Remove a tag',
      'Set the account status',
      'Add values to a list',
      'Export as CSV',
    ]);
    unmount();
    renderPanel({ action, abilities: { tags: false, lists: false, export: true } });
    expect(
      within(screen.getByRole('combobox', { name: 'Action' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Export as CSV']);
  });

  it('says nothing can be done when the role holds no action’s scope', () => {
    renderPanel({
      action: vi.fn<Action>(),
      abilities: { tags: false, lists: false, export: false },
    });
    expect(screen.queryByRole('combobox', { name: 'Action' })).toBeNull();
    expect(
      screen.getByText(/Your role holds none of the scopes a bulk action needs/),
    ).toBeVisible();
  });

  it('previews first, then applies after a confirmation, and says each account’s outcome in words', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<Action>()
      .mockImplementationOnce(() => answer({ preview: true, selectedCount: 2 }))
      .mockImplementationOnce(() =>
        answer({
          preview: false,
          selectedCount: 2,
          outcomes: [
            { accountId: IDS.accountA, outcome: 'done' },
            { accountId: IDS.accountB, outcome: 'skipped_consolidated' },
          ],
        }),
      );
    renderPanel({ action });
    await user.type(screen.getByRole('textbox', { name: 'Tag' }), 'ring-review');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByText(
        '2 of the 2 selected accounts are in the stored result and would be acted on.',
      ),
    ).toBeVisible();
    const preview = action.mock.calls[0]?.[1];
    expect(preview?.get('preview')).toBe('true');
    expect(preview?.getAll('account-id')).toEqual([IDS.accountA, IDS.accountB]);
    expect(preview?.get('tag')).toBe('ring-review');

    await user.click(screen.getByRole('button', { name: 'Apply…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a tag to 2 accounts?' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const outcomes = await screen.findByRole('table', { name: 'Outcome of each account' });
    expect(within(outcomes).getByText('Done')).toBeVisible();
    expect(
      within(outcomes).getByText('Skipped: the account was merged into another'),
    ).toBeVisible();
    expect(action.mock.calls[1]?.[1].get('preview')).toBeNull();
    expect(screen.getByText('1 done, 1 skipped.')).toBeVisible();
  });

  it('acts on every account of the result with all, and refuses all above 500 accounts', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => answer({ selectedCount: 3 }));
    const { unmount } = renderPanel({ action, selected: new Set() });
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Every account in the result (3)' }));
    await user.type(screen.getByRole('textbox', { name: 'Tag' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/3 of the 3 accounts/);
    expect(action.mock.calls[0]?.[1].get('all')).toBe('true');
    unmount();
    renderPanel({ action, accountCount: 501, selected: new Set() });
    expect(screen.getByRole('radio', { name: /Every account in the result/ })).toBeDisabled();
    expect(screen.getByText(/at most 500 accounts/)).toBeVisible();
  });

  it('says a refusal of the whole call in words', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() =>
      later({
        ok: false as const,
        problem: { title: GRAPH_PROBLEM_WORDS.selection_too_large, code: 'selection_too_large' },
      }),
    );
    renderPanel({ action });
    await user.type(screen.getByRole('textbox', { name: 'Tag' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      GRAPH_PROBLEM_WORDS.selection_too_large,
    );
  });

  it('adds a kind’s values to a chosen list', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => answer({ action: 'add-to-list' }));
    renderPanel({ action });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'add-to-list');
    await user.selectOptions(screen.getByRole('combobox', { name: 'List' }), IDS.list);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Values of kind' }),
      'email_address',
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/would be acted on/);
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('list-id')).toBe(IDS.list);
    expect(sent?.get('kind')).toBe('email_address');
  });

  it('downloads the export through its own route after a preview, posting the same selection', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => answer({ action: 'export', selectedCount: 2 }));
    renderPanel({ action });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'export');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/would be acted on/);
    await user.click(screen.getByRole('button', { name: 'Download…' }));
    const dialog = screen.getByRole('dialog', { name: 'Export 2 accounts as CSV?' });
    expect(dialog).toHaveTextContent(/personal data/);
    const download = document.querySelector<HTMLFormElement>('form[data-export]');
    expect(download?.getAttribute('method')).toBe('post');
    expect(download?.getAttribute('action')).toBe(`/graph/${IDS.query}/export`);
    const fields = new FormData(download ?? undefined);
    expect(fields.getAll('account-id')).toEqual([IDS.accountA, IDS.accountB]);
  });
});

describe('the create-case bulk action (C140.6, Workflow 8C)', () => {
  const CASE_TEMPLATE = 'ctmpl_01JE0000000000000000000001';
  const CREATED = 'case_01JE0000000000000000000001';
  const TEMPLATES = [{ id: CASE_TEMPLATE, name: 'Synthetic KYC review' }];

  it('is offered with cases:write, on a published template, and opens the case it made', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<Action>()
      .mockImplementationOnce(() =>
        answer({ action: 'create-case', preview: true, selectedCount: 2 }),
      )
      .mockImplementationOnce(() =>
        answer({
          action: 'create-case',
          preview: false,
          selectedCount: 2,
          caseId: CREATED,
          outcomes: [
            { accountId: IDS.accountA, outcome: 'done' },
            { accountId: IDS.accountB, outcome: 'done' },
          ],
        }),
      );
    renderPanel({
      action,
      abilities: { tags: false, lists: false, export: false, cases: true },
      caseTemplates: TEMPLATES,
      caseQueues: [{ id: 'cqueue_01JE0000000000000000000001', name: 'Synthetic first line' }],
    });
    expect(
      within(screen.getByRole('combobox', { name: 'Action' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Create a case']);
    expect(screen.getByRole('combobox', { name: 'Case template' })).toHaveValue(CASE_TEMPLATE);
    expect(screen.getByRole('combobox', { name: 'Queue' })).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(
      '2 of the 2 selected accounts are in the stored result and would be acted on.',
    );
    expect(action.mock.calls[0]?.[1].get('case-template-id')).toBe(CASE_TEMPLATE);
    await user.click(screen.getByRole('button', { name: 'Apply…' }));
    const dialog = screen.getByRole('dialog', { name: 'Create one case holding 2 accounts?' });
    expect(dialog).toHaveTextContent(/history names this query/u);
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('link', { name: `Open case ${CREATED}` })).toHaveAttribute(
      'href',
      `/cases/${CREATED}`,
    );
  });

  it('says no case was made when no account could be held, and that a template is needed', async () => {
    const user = userEvent.setup();
    const action = vi
      .fn<Action>()
      .mockImplementationOnce(() =>
        answer({ action: 'create-case', preview: true, selectedCount: 1 }),
      )
      .mockImplementationOnce(() =>
        answer({
          action: 'create-case',
          preview: false,
          selectedCount: 1,
          caseId: null,
          outcomes: [{ accountId: IDS.accountA, outcome: 'skipped_redacted' }],
        }),
      );
    const { unmount } = renderPanel({
      action,
      abilities: { tags: false, lists: false, export: false, cases: true },
      caseTemplates: TEMPLATES,
    });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(await screen.findByRole('button', { name: 'Apply…' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Create one case holding 1 account?' })).getByRole(
        'button',
        { name: 'Apply' },
      ),
    );
    expect(
      await screen.findByText(
        'No case was made: none of the accounts could be held (redacted and merged accounts are skipped).',
      ),
    ).toBeVisible();
    unmount();

    renderPanel({
      action: vi.fn<Action>(),
      abilities: { tags: false, lists: false, export: false, cases: true },
      caseTemplates: [],
    });
    expect(
      screen.getByText('No published case template to create a case with: publish one first.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });
});
