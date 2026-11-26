import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  inquiry,
  inquiryList,
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import {
  NOT_COMPUTED_SIGNALS,
  SIGNAL_IDS,
  computedSignals,
  listMatch,
  matchList,
} from '../../../testing/signals-fixtures';
import AccountPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = `/accounts/${IDS.account}`;
const MATCHES = '/list-matches';
let api: RouteApi;

const signIn = (...permissions: Permission[]) => {
  api.me({ permissions: ['accounts:read', ...permissions] });
};

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  signIn();
  api.on('GET', ACCOUNT, 200, single(account()));
  api.on('GET', `${ACCOUNT}/relations`, 200, relations([]));
  api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
  api.on(
    'GET',
    '/inquiries',
    200,
    inquiryList([inquiry(computedSignals()), inquiry(NOT_COMPUTED_SIGNALS, IDS.otherInquiry)]),
  );
  api.on('GET', MATCHES, 200, matchList([listMatch()]));
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
const region = (name: string) => screen.getByRole('region', { name });

describe('the account Signals section (C108)', () => {
  it('shows the signals of its latest inquiries with inquiries:read, in words', async () => {
    signIn('inquiries:read');

    await show();

    const signals = region('Signals');
    const table = within(signals).getByRole('table', { name: 'Signals of the latest inquiries' });
    expect(table).toHaveTextContent('12 of 100: no automation artefacts found');
    expect(table).toHaveTextContent('Not evaluated: too little behaviour was recorded');
    expect(within(table).getAllByRole('link', { name: IDS.inquiry }).at(0)).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(table).toHaveTextContent('Not computed yet');
    expect(within(signals).getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });

  it('shows no signals without inquiries:read', async () => {
    await show();

    expect(screen.queryByRole('region', { name: 'Signals' })).toBeNull();
  });
});

describe('the account List matches section (C99.3, C108)', () => {
  it('lists the account matches with lists:read', async () => {
    signIn('lists:read');

    await show();

    const section = region('List matches');
    expect(within(section).getByRole('rowheader', { name: SIGNAL_IDS.match })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', MATCHES)?.query ?? [])).toMatchObject({
      'filter[account-id]': IDS.account,
    });
    expect(within(section).queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });

  it('offers dismissal with lists:write', async () => {
    signIn('lists:read', 'lists:write');

    await show();

    expect(
      within(region('List matches')).getByRole('button', {
        name: `Dismiss list match ${SIGNAL_IDS.match}`,
      }),
    ).toBeVisible();
  });

  it('reads no matches and shows no section without lists:read', async () => {
    await show();

    expect(screen.queryByRole('region', { name: 'List matches' })).toBeNull();
    expect(api.find('GET', MATCHES)).toBeUndefined();
  });

  it('shows the forbidden panel when the API refuses the matches', async () => {
    signIn('lists:read');
    api.onProblem('GET', MATCHES, 403, 'forbidden');

    await show();

    expect(within(region('List matches')).getByText('You do not have access')).toBeVisible();
  });
});
