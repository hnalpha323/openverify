import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pagination } from './pagination';

const CURSOR = 'inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';

describe('Pagination', () => {
  it('links to the next page with the same filter', () => {
    render(<Pagination path="/inquiries" query={{ status: 'failed' }} nextCursor={CURSOR} />);

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
    const next = screen.getByRole('link', { name: 'Next page' });
    expect(next).toHaveAttribute('href', `/inquiries?status=failed&after=${CURSOR}`);
    expect(next).toHaveAttribute('rel', 'next');
    expect(screen.queryByRole('link', { name: 'First page' })).not.toBeInTheDocument();
  });

  it('links back to the first page once past it', () => {
    render(
      <Pagination
        path="/inquiries"
        query={{ status: 'failed' }}
        after={CURSOR}
        nextCursor={null}
      />,
    );

    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute(
      'href',
      '/inquiries?status=failed',
    );
    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('works for any list, with several values of a filter', () => {
    render(
      <Pagination path="/accounts" query={{ status: ['active', 'archived'] }} nextCursor="acc_1" />,
    );

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/accounts?status=active&status=archived&after=acc_1',
    );
  });

  it('names its cursor and its landmark, for a page with several lists', () => {
    render(
      <Pagination
        path="/transactions/txn_1"
        query={{ 'labels-after': 'txnl_1' }}
        param="status-after"
        label="Status history pages"
        after="50"
        nextCursor="41"
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Status history pages' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/transactions/txn_1?labels-after=txnl_1&status-after=41',
    );
  });

  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pagination path="/inquiries" query={{}} nextCursor={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
