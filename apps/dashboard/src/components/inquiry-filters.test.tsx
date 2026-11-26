import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseInquiryListQuery } from '../lib/inquiry-query';
import { InquiryFilters } from './inquiry-filters';

const ACCOUNT = 'acc_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

function renderFilters(params: Record<string, string | string[]> = {}) {
  const query = parseInquiryListQuery(params);
  render(
    <InquiryFilters
      values={query.values}
      statuses={query.filters.statuses}
      errors={query.errors}
    />,
  );
  return screen.getByRole('search', { name: 'Filter inquiries' });
}

describe('InquiryFilters', () => {
  it('is a search form that works without JavaScript (GET /inquiries)', () => {
    const form = renderFilters();

    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/inquiries');
    expect(within(form).getByRole('button', { name: 'Apply filters' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('offers every status as a checkbox in a labelled group, none checked by default', () => {
    const form = renderFilters();
    const group = within(form).getByRole('group', { name: 'Status' });
    const boxes = within(group).getAllByRole('checkbox');

    expect(boxes.map((box) => box.getAttribute('value'))).toEqual([
      'created',
      'pending',
      'completed',
      'failed',
      'expired',
      'approved',
      'declined',
      'needs_review',
    ]);
    expect(within(group).getByRole('checkbox', { name: 'Needs review' })).toHaveAttribute(
      'name',
      'status',
    );
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it('labels the tag, account, reference and creation date filters', () => {
    const form = renderFilters();

    expect(within(form).getByRole('textbox', { name: 'Tags' })).toHaveAttribute('name', 'tag');
    expect(within(form).getByRole('textbox', { name: 'Account ID' })).toHaveAttribute(
      'name',
      'account-id',
    );
    expect(within(form).getByRole('textbox', { name: 'Reference ID' })).toHaveAttribute(
      'name',
      'reference-id',
    );
    expect(within(form).getByLabelText('Created from (UTC)')).toHaveAttribute('type', 'date');
    expect(within(form).getByLabelText('Created to (UTC)')).toHaveAttribute('name', 'created-to');
  });

  it('shows the active filters and offers to clear them', () => {
    const form = renderFilters({
      status: ['failed', 'needs_review'],
      tag: 'vip',
      'account-id': ACCOUNT,
      'created-from': '2026-10-01',
    });

    expect(within(form).getByRole('checkbox', { name: 'Failed' })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Needs review' })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Approved' })).not.toBeChecked();
    expect(within(form).getByRole('textbox', { name: 'Tags' })).toHaveValue('vip');
    expect(within(form).getByRole('textbox', { name: 'Account ID' })).toHaveValue(ACCOUNT);
    expect(within(form).getByLabelText('Created from (UTC)')).toHaveValue('2026-10-01');
    expect(within(form).getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/inquiries',
    );
  });

  it('offers no clear link while nothing is filtered', () => {
    const form = renderFilters();

    expect(within(form).queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('marks a value the API would refuse as invalid and says why', () => {
    const form = renderFilters({ 'account-id': 'not-an-account' });
    const input = within(form).getByRole('textbox', { name: 'Account ID' });

    expect(input).toHaveValue('not-an-account');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/acc_/);
  });
});

describe('the C165.3 filters (Workflow 9C)', () => {
  it('offers the list match, the list, and a check with its status', () => {
    render(<InquiryFilters values={{}} statuses={[]} errors={{}} />);

    expect(
      within(screen.getByLabelText('List screening'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any', 'Matched a list', 'Screened, no match', 'Not fully screened']);
    expect(screen.getByLabelText('List ID')).toBeVisible();
    expect(screen.getByLabelText('Check')).toBeVisible();
    expect(
      within(screen.getByLabelText('Check status'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any', 'Passed', 'Failed', 'Not applicable', 'Pending']);
  });

  it('offers the step filter only to a reader who sees personal data', () => {
    const { rerender } = render(<InquiryFilters values={{}} statuses={[]} errors={{}} />);
    expect(screen.queryByLabelText('Current step')).toBeNull();

    rerender(<InquiryFilters values={{}} statuses={[]} errors={{}} canFilterByStep />);
    expect(screen.getByLabelText('Current step')).toBeVisible();
  });
});
