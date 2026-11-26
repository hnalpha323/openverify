import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  TRANSACTIONS_PATH,
  TRANSACTION_TYPES_PATH,
  serveTransactionTypes,
  serveTransactions,
} from '../../testing/routes/transactions';
import { TRANSACTION_IDS, transaction, transactionType } from '../../testing/transactions-fixtures';
import TransactionsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['transactions:read'] });
  serveTransactionTypes(api, [transactionType()]);
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => TransactionsPage({ searchParams: Promise.resolve(params) });
const listQuery = () => Object.fromEntries(api.find('GET', TRANSACTIONS_PATH)?.query ?? []);

describe('the transactions index (C105, C108)', () => {
  it('is titled Transactions, and lists each one with its type, status, reference, tags and creation', async () => {
    expect(metadata.title).toBe('Transactions');
    serveTransactions(api, [transaction({ status: 'needs review' })]);

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Transactions' });
    const row = within(
      within(table)
        .getByRole('rowheader', { name: TRANSACTION_IDS.transaction })
        .closest('tr') as HTMLElement,
    );
    expect(row.getByRole('link', { name: TRANSACTION_IDS.transaction })).toHaveAttribute(
      'href',
      `/transactions/${TRANSACTION_IDS.transaction}`,
    );
    expect(row.getByRole('link', { name: 'Synthetic order' })).toHaveAttribute(
      'href',
      `/transaction-types/${TRANSACTION_IDS.type}`,
    );
    expect(row.getByText('needs review')).toBeVisible();
    expect(row.getByText('order-0001')).toBeVisible();
    expect(row.getByText('priority')).toBeVisible();
    expect(listQuery()).toEqual({ 'page[size]': '25' });
    expect(Object.fromEntries(api.find('GET', TRANSACTION_TYPES_PATH)?.query ?? [])).toEqual({
      'page[size]': '100',
    });
  });

  it('passes the type, status, reference and date filters, and keeps them on the next page', async () => {
    serveTransactions(
      api,
      [],
      `/api/v1/transactions?page%5Bafter%5D=${TRANSACTION_IDS.otherTransaction}`,
    );

    render(
      await page({
        type: TRANSACTION_IDS.type,
        status: 'needs review',
        reference: 'order-0001',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );

    expect(listQuery()).toEqual({
      'filter[transaction-type-id]': TRANSACTION_IDS.type,
      'filter[status]': 'needs review',
      'filter[reference-id]': 'order-0001',
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-11-01T00:00:00.000Z',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter transactions' });
    expect(within(filters).getByRole('combobox', { name: 'Type' })).toHaveValue(
      TRANSACTION_IDS.type,
    );
    expect(within(filters).getByRole('textbox', { name: 'Status' })).toHaveValue('needs review');
    expect(within(filters).getByRole('textbox', { name: 'Reference' })).toHaveValue('order-0001');
    expect(within(filters).getByLabelText('Created from (UTC)')).toHaveValue('2026-10-01');
    expect(within(filters).getByLabelText('Created to (UTC, inclusive)')).toHaveValue('2026-10-31');
    expect(screen.getByRole('cell')).toHaveTextContent('No transactions match these filters.');
    const next = new URL(
      screen.getByRole('link', { name: 'Next page' }).getAttribute('href') ?? '',
      'http://dashboard.test',
    );
    expect(next.searchParams.get('reference')).toBe('order-0001');
    expect(next.searchParams.get('from')).toBe('2026-10-01');
    expect(next.searchParams.get('after')).toBe(TRANSACTION_IDS.otherTransaction);
  });

  it('explains a filter the API would refuse, and lists nothing until it is corrected', async () => {
    render(await page({ from: '2026-10-31', to: '2026-10-01', type: 'nope' }));

    expect(api.find('GET', TRANSACTIONS_PATH)).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the filters');
    expect(screen.getByLabelText('Created to (UTC, inclusive)')).toHaveAccessibleDescription(
      'The end must not be before the start.',
    );
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveAccessibleDescription(
      'Choose a transaction type from the list.',
    );
  });

  it('says when the environment has no transaction yet', async () => {
    serveTransactions(api, []);

    render(await page());

    expect(screen.getByRole('heading', { name: 'No transactions yet' })).toBeVisible();
  });

  it('shows the forbidden panel without transactions:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', TRANSACTIONS_PATH)).toBeUndefined();
  });
});
