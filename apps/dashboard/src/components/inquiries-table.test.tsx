import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InquiriesTable, type InquirySummary } from './inquiries-table';

// Synthetic fixtures only: no real people, no real identifiers.
const APPROVED: InquirySummary = {
  id: 'inq_synthetic_0001',
  referenceId: 'ref-synthetic-0001',
  status: 'approved',
  tags: ['vip', 'manual review'],
  accountId: 'acc_synthetic_0001',
  createdAt: '2026-10-20T04:35:00.000Z',
};

const NEEDS_REVIEW: InquirySummary = {
  id: 'inq_synthetic_0002',
  referenceId: null,
  status: 'needs_review',
  tags: [],
  accountId: null,
  createdAt: '2026-10-19T23:05:00.000Z',
};

function rowFor(id: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name: id });
  const row = header.closest('tr');
  if (row === null) throw new Error(`No row for ${id}`);
  return row;
}

describe('InquiriesTable', () => {
  it('lists inquiries in a named table with the expected columns', () => {
    render(<InquiriesTable inquiries={[APPROVED, NEEDS_REVIEW]} />);

    expect(screen.getByRole('table', { name: 'Inquiries' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Inquiry ID',
      'Reference ID',
      'Status',
      'Tags',
      'Account',
      'Created (UTC)',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows each inquiry with its ID as the row header, linking to its detail page', () => {
    render(<InquiriesTable inquiries={[APPROVED]} />);
    const row = rowFor('inq_synthetic_0001');

    expect(within(row).getByRole('link', { name: 'inq_synthetic_0001' })).toHaveAttribute(
      'href',
      '/inquiries/inq_synthetic_0001',
    );
    expect(within(row).getByText('ref-synthetic-0001')).toBeVisible();
    expect(within(row).getByText('Approved')).toHaveAttribute('data-status', 'approved');
  });

  it("lists the inquiry's tags", () => {
    render(<InquiriesTable inquiries={[APPROVED]} />);

    const tags = within(rowFor('inq_synthetic_0001')).getByRole('list', { name: 'Tags' });
    expect(
      within(tags)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['vip', 'manual review']);
  });

  it('links the account when the operator may read accounts', () => {
    render(<InquiriesTable inquiries={[APPROVED]} linkAccounts />);

    expect(
      within(rowFor('inq_synthetic_0001')).getByRole('link', { name: 'acc_synthetic_0001' }),
    ).toHaveAttribute('href', '/accounts/acc_synthetic_0001');
  });

  it('names the account without a link otherwise', () => {
    render(<InquiriesTable inquiries={[APPROVED]} />);
    const row = rowFor('inq_synthetic_0001');

    expect(within(row).getByText('acc_synthetic_0001')).toBeVisible();
    expect(within(row).queryByRole('link', { name: 'acc_synthetic_0001' })).not.toBeInTheDocument();
  });

  it('shows a missing reference ID, tags and account as missing', () => {
    render(<InquiriesTable inquiries={[NEEDS_REVIEW]} />);

    expect(within(rowFor('inq_synthetic_0002')).getAllByText('None')).toHaveLength(3);
  });

  it('shows creation times in UTC with a machine-readable timestamp', () => {
    render(<InquiriesTable inquiries={[APPROVED]} />);
    const time = within(rowFor('inq_synthetic_0001')).getByText(/Oct 20, 2026/);

    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-20T04:35:00.000Z');
    expect(time).toHaveTextContent(/4:35/);
  });

  it('shows an unparseable timestamp as given instead of crashing', () => {
    render(<InquiriesTable inquiries={[{ ...APPROVED, createdAt: 'not-a-date' }]} />);

    expect(within(rowFor('inq_synthetic_0001')).getByText('not-a-date')).toBeVisible();
  });

  it('shows the empty message when there are no inquiries', () => {
    render(<InquiriesTable inquiries={[]} emptyMessage="No inquiries match these filters." />);

    expect(screen.getByRole('cell')).toHaveTextContent('No inquiries match these filters.');
  });
});
