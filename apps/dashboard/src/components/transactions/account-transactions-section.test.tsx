import { render, screen, within } from '@testing-library/react';
import type { Permission } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS, account } from '../../testing/lifecycle-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  MASKED_FIELDS,
  NOTE_VALUE,
  TRANSACTION_IDS,
  transaction,
} from '../../testing/transactions-fixtures';
import { AccountTransactionsSection } from './account-transactions-section';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const ACCOUNT = `/accounts/${LIFECYCLE_IDS.account}`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const section = (permissions: readonly Permission[] = ['transactions:read']) =>
  AccountTransactionsSection({
    accountId: LIFECYCLE_IDS.account,
    permissions: new Set(permissions),
  });

describe("the account page's transactions section (C108)", () => {
  it('reads the account with include=transactions, and lists each with its status, reference and creation', async () => {
    api.on('GET', ACCOUNT, 200, {
      data: account(),
      included: [
        transaction({ status: 'approved', fields: MASKED_FIELDS }),
        transaction({
          id: TRANSACTION_IDS.otherTransaction,
          referenceId: null,
          fields: MASKED_FIELDS,
        }),
      ],
    });

    render(<>{await section()}</>);

    expect(Object.fromEntries(api.find('GET', ACCOUNT)?.query ?? [])).toEqual({
      include: 'transactions',
    });
    const table = screen.getByRole('table', { name: 'Transactions of this account' });
    const row = within(
      within(table)
        .getByRole('rowheader', { name: TRANSACTION_IDS.transaction })
        .closest('tr') as HTMLElement,
    );
    expect(row.getByRole('link', { name: TRANSACTION_IDS.transaction })).toHaveAttribute(
      'href',
      `/transactions/${TRANSACTION_IDS.transaction}`,
    );
    expect(row.getByText('approved')).toBeVisible();
    expect(row.getByText('order-0001')).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('carries no field value into the RSC payload, even when the API shows them', async () => {
    api.on('GET', ACCOUNT, 200, { data: account(), included: [transaction()] });

    expect(await rscPayloadOf(await section(['transactions:read', 'pii:view']))).not.toContain(
      NOTE_VALUE,
    );
  });

  it('says when the account has no transaction', async () => {
    api.on('GET', ACCOUNT, 200, { data: account() });

    render(<>{await section()}</>);

    expect(screen.getByText('No transaction names this account.')).toBeVisible();
  });

  it('leaves the section out without transactions:read, asking nothing', async () => {
    expect(await section(['accounts:read'])).toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});
