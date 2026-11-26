import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { AccountRelations } from './account-relations';
import { LIFECYCLE_IDS as IDS, relations } from '../../testing/lifecycle-fixtures';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const ok = () => vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));

const ITEMS = relations([
  {},
  {
    direction: 'incoming',
    'relation-type': 'business_owner',
    'related-account': { type: 'account', id: IDS.thirdAccount },
  },
]).data;

function renderRelations(canEdit = true, items = ITEMS) {
  const actions = { add: ok(), remove: ok() };
  render(
    <ToastProvider>
      <AccountRelations accountId={IDS.account} relations={items} canEdit={canEdit} {...actions} />
    </ToastProvider>,
  );
  return actions;
}

const rowFor = (id: string) => {
  const row = screen.getByRole('link', { name: id }).closest('tr');
  if (row === null) throw new Error(`No row for ${id}`);
  return row;
};

describe('AccountRelations', () => {
  it('lists each relation with its direction, read-only without accounts:write', () => {
    renderRelations(false);

    expect(within(rowFor(IDS.otherAccount)).getByText('From this account')).toBeVisible();
    expect(within(rowFor(IDS.otherAccount)).getByText('spouse')).toBeVisible();
    expect(within(rowFor(IDS.thirdAccount)).getByText('To this account')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says when there are no relations', () => {
    renderRelations(false, []);

    expect(screen.getByText('No relations.')).toBeVisible();
  });

  it('names each row action and its dialog after the relation it removes (WCAG 2.4.6, Workflow 2E F014)', async () => {
    renderRelations();

    const outgoing = `Remove the spouse relation to ${IDS.otherAccount}`;
    const incoming = `Remove the business_owner relation from ${IDS.thirdAccount}`;
    expect(within(rowFor(IDS.otherAccount)).getByRole('button', { name: outgoing })).toBeVisible();
    expect(within(rowFor(IDS.thirdAccount)).getByRole('button', { name: incoming })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: incoming }));
    expect(screen.getByRole('dialog', { name: `${incoming}?` })).toBeVisible();
  });

  it('removes an outgoing relation from this account', async () => {
    const { remove } = renderRelations();

    await userEvent.click(
      within(rowFor(IDS.otherAccount)).getByRole('button', { name: /^Remove/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove relation' }));

    const sent = remove.mock.calls[0]?.[1];
    expect(Object.fromEntries(sent ?? [])).toEqual({
      'account-id': IDS.account,
      'from-account-id': IDS.account,
      'related-account-id': IDS.otherAccount,
      'relation-type': 'spouse',
    });
  });

  it('removes an incoming relation from the account it starts at', async () => {
    const { remove } = renderRelations();

    await userEvent.click(
      within(rowFor(IDS.thirdAccount)).getByRole('button', { name: /^Remove/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove relation' }));

    expect(Object.fromEntries(remove.mock.calls[0]?.[1] ?? [])).toEqual({
      'account-id': IDS.account,
      'from-account-id': IDS.thirdAccount,
      'related-account-id': IDS.account,
      'relation-type': 'business_owner',
    });
  });

  it('adds a relation', async () => {
    const { add } = renderRelations();

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Related account ID' }),
      IDS.thirdAccount,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Relation type' }), 'spouse');
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));

    expect(Object.fromEntries(add.mock.calls[0]?.[1] ?? [])).toEqual({
      'account-id': IDS.account,
      'related-account-id': IDS.thirdAccount,
      'relation-type': 'spouse',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Added the relation.');
  });

  it('shows why a relation was refused next to its field', async () => {
    const actions = { add: ok(), remove: ok() };
    actions.add.mockResolvedValueOnce({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        errors: [{ pointer: '/meta/relation-type', detail: 'must be a snake_case relation type' }],
      },
    });
    render(
      <ToastProvider>
        <AccountRelations accountId={IDS.account} relations={[]} canEdit {...actions} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));

    expect(
      await screen.findByRole('textbox', { name: 'Relation type' }),
    ).toHaveAccessibleDescription(/must be a snake_case relation type/);
  });
});
