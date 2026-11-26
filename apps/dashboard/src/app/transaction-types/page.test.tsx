import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  TRANSACTION_DEVELOPER,
  TRANSACTION_TYPES_PATH,
  serveTransactionTypes,
} from '../../testing/routes/transactions';
import { TRANSACTION_IDS, transactionType } from '../../testing/transactions-fixtures';
import TransactionTypesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['transactions:read'] });
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await TransactionTypesPage({ searchParams: Promise.resolve(params) })}
    </ToastProvider>,
  );

describe('the transaction types (C104, C108)', () => {
  it('lists each type with its status and its latest and published version numbers', async () => {
    expect(metadata.title).toBe('Transaction types');
    serveTransactionTypes(api, [
      transactionType(),
      transactionType({
        id: TRANSACTION_IDS.otherType,
        name: 'Synthetic refund',
        latestVersion: 1,
        publishedVersion: null,
      }),
    ]);

    await page();

    const table = screen.getByRole('table', { name: 'Transaction types' });
    const order = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic order' })
        .closest('tr') as HTMLElement,
    );
    expect(order.getByRole('link', { name: 'Synthetic order' })).toHaveAttribute(
      'href',
      `/transaction-types/${TRANSACTION_IDS.type}`,
    );
    expect(order.getByText('v3')).toBeVisible();
    expect(order.getByText('v2')).toBeVisible();
    const refund = within(
      within(table)
        .getByRole('rowheader', { name: 'Synthetic refund' })
        .closest('tr') as HTMLElement,
    );
    expect(refund.getByText('Not published yet')).toBeVisible();
    expect(Object.fromEntries(api.find('GET', TRANSACTION_TYPES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
    expect(screen.queryByRole('form', { name: 'Create a transaction type' })).toBeNull();
  });

  it('offers creation with transaction-types:write', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionTypes(api, []);

    await page();

    expect(screen.getByRole('heading', { name: 'No transaction types yet' })).toBeVisible();
    const create = screen.getByRole('form', { name: 'Create a transaction type' });
    expect(within(create).getByRole('textbox', { name: /^Name/u })).toBeRequired();
  });

  it('shows the forbidden panel without transactions:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});
