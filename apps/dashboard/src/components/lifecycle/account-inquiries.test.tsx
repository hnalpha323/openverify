import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { AccountInquiries, type AccountInquiriesProps } from './account-inquiries';
import { LIFECYCLE_IDS as IDS } from '../../testing/lifecycle-fixtures';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const ok = () => vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));

const SUMMARY = {
  id: IDS.inquiry,
  referenceId: 'ref-synthetic-001',
  status: 'completed',
  tags: [],
  accountId: IDS.account,
  createdAt: '2026-10-20T04:35:00.000Z',
} as const;

function renderInquiries(props: Partial<AccountInquiriesProps> = {}) {
  const actions = { add: ok(), remove: ok() };
  render(
    <ToastProvider>
      <AccountInquiries
        accountId={IDS.account}
        inquiries={{ kind: 'listed', items: [SUMMARY], nextCursor: null }}
        canEdit
        {...actions}
        {...props}
      />
    </ToastProvider>,
  );
  return actions;
}

describe('AccountInquiries', () => {
  it("lists the account's inquiries with links", () => {
    renderInquiries({ canEdit: false });

    const table = screen.getByRole('table', { name: 'Account inquiries' });
    expect(within(table).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(within(table).getByText('Completed')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists only the ids when the operator cannot read inquiries', () => {
    renderInquiries({ inquiries: { kind: 'ids', ids: [IDS.inquiry, IDS.otherInquiry] } });

    const list = screen.getByRole('list', { name: 'Account inquiries' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([IDS.inquiry, IDS.otherInquiry]);
    expect(screen.queryByRole('link', { name: IDS.inquiry })).not.toBeInTheDocument();
  });

  it('says when the account has no inquiries', () => {
    renderInquiries({ inquiries: { kind: 'listed', items: [], nextCursor: null }, canEdit: false });

    expect(screen.getByText('No inquiries belong to this account.')).toBeVisible();
  });

  it('unlinks one inquiry after confirmation', async () => {
    const { remove } = renderInquiries();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove inquiry' }));

    expect(Object.fromEntries(remove.mock.calls[0]?.[1] ?? [])).toEqual({
      'account-id': IDS.account,
      'inquiry-id': IDS.inquiry,
    });
  });

  it('links inquiries typed by id', async () => {
    const { add } = renderInquiries();

    await userEvent.type(screen.getByRole('textbox', { name: 'Inquiry IDs' }), IDS.otherInquiry);
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));

    expect(Object.fromEntries(add.mock.calls[0]?.[1] ?? [])).toEqual({
      'account-id': IDS.account,
      'inquiry-ids': IDS.otherInquiry,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Added the inquiries.');
  });

  it('pages through the inquiries in the account page URL', () => {
    renderInquiries({
      inquiries: { kind: 'listed', items: [SUMMARY], nextCursor: IDS.inquiry },
      after: IDS.thirdInquiry,
    });

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/accounts/${IDS.account}?after=${IDS.inquiry}`,
    );
    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      `/accounts/${IDS.account}`,
    );
  });

  it('shows why typed inquiries were refused, at the field or below it', async () => {
    const actions = renderInquiries();
    // Answered after a macrotask, as a server action is (Workflow 2D F019).
    actions.add
      .mockImplementationOnce(() =>
        later<ActionResult>({
          ok: false,
          problem: {
            title: 'Check the values you entered',
            errors: [{ pointer: '/meta/objects', detail: 'Enter 1 to 100 inquiry IDs.' }],
          },
        }),
      )
      .mockImplementationOnce(() =>
        later<ActionResult>({ ok: false, problem: { title: 'Not Found', detail: 'No inquiry.' } }),
      );
    const input = screen.getByRole('textbox', { name: 'Inquiry IDs' });

    await userEvent.type(input, 'inq_x');
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));
    // Waits until the answer gives the field its error, not just for the field.
    expect(
      await screen.findByRole('textbox', {
        name: 'Inquiry IDs',
        description: /Enter 1 to 100 inquiry IDs/,
      }),
    ).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(screen.getByRole('textbox', { name: 'Inquiry IDs' }), IDS.otherInquiry);
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));
    expect(await screen.findByText('No inquiry.')).toBeVisible();
  });
});
