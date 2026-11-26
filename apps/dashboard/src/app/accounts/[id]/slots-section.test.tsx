import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { ForbiddenError } from '../../../lib/api/errors';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import AccountPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const slots = vi.hoisted(() => ({
  graph: vi.fn(),
  transactions: vi.fn(),
}));

vi.mock('../../../components/graph/account-graph-section', () => ({
  AccountGraphSection: slots.graph,
}));
vi.mock('../../../components/transactions/account-transactions-section', () => ({
  AccountTransactionsSection: slots.transactions,
}));

const ACCOUNT = `/accounts/${IDS.account}`;
let api: RouteApi;

const signIn = (permissions: Permission[]) => {
  api.me({ permissions });
};

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', ACCOUNT, 200, single(account()));
  api.on('GET', `${ACCOUNT}/relations`, 200, relations([]));
  api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
  slots.graph.mockReset();
  slots.transactions.mockReset();
  slots.graph.mockResolvedValue(<p>The graph slot</p>);
  slots.transactions.mockResolvedValue(<p>The transactions slot</p>);
});

afterEach(() => {
  api.restore();
});

const show = async () => {
  render(
    <ToastProvider>
      {await AccountPage({
        params: Promise.resolve({ id: IDS.account }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );
};

describe.each([
  { name: 'Graph', scope: 'graph:read', slot: 'graph', text: 'The graph slot' },
  {
    name: 'Transactions',
    scope: 'transactions:read',
    slot: 'transactions',
    text: 'The transactions slot',
  },
] as const)('the account page $name slot (C108, F32)', ({ name, scope, slot, text }) => {
  it(`calls it with the account id and the principal's permissions, under ${scope}`, async () => {
    signIn(['accounts:read', scope]);

    await show();

    expect(slots[slot]).toHaveBeenCalledTimes(1);
    expect(slots[slot]).toHaveBeenCalledWith({
      accountId: IDS.account,
      permissions: new Set(['accounts:read', scope]),
    });
    expect(within(screen.getByRole('region', { name })).getByText(text)).toBeVisible();
  });

  it(`never calls it, and shows no section, without ${scope}`, async () => {
    signIn(['accounts:read']);

    await show();

    expect(slots[slot]).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name })).toBeNull();
  });

  it('shows the forbidden panel in the section when the API refuses its read', async () => {
    signIn(['accounts:read', scope]);
    slots[slot].mockRejectedValue(new ForbiddenError([scope]));

    await show();

    expect(
      within(screen.getByRole('region', { name })).getByText('You do not have access'),
    ).toBeVisible();
  });

  it('leaves the section out when the slot renders nothing', async () => {
    signIn(['accounts:read', scope]);
    slots[slot].mockResolvedValue(null);

    await show();

    expect(screen.queryByRole('region', { name })).toBeNull();
  });
});
