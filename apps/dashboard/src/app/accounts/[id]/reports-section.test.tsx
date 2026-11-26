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
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import { REPORT_IDS, report, reportList } from '../../../testing/report-fixtures';
import AccountPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = `/accounts/${IDS.account}`;
const REPORTS = '/dashboard/reports';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['accounts:read', 'reports:read'] });
  api.on('GET', ACCOUNT, 200, single(account()));
  api.on('GET', `${ACCOUNT}/relations`, 200, relations([]));
  api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
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
const section = () => screen.getByRole('region', { name: 'Reports' });

describe('the reports section of the account page (C70.5, C84.4, C86)', () => {
  it('lists the reports linked to the account, as home or linked account', async () => {
    api.on(
      'GET',
      REPORTS,
      200,
      reportList(
        [report('watchlist')],
        `/api/v1/dashboard/reports?page%5Bafter%5D=${REPORT_IDS.report}`,
      ),
    );

    await show();

    const table = within(section()).getByRole('table', { name: 'Reports of this account' });
    expect(within(table).getByRole('rowheader', { name: REPORT_IDS.report })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', REPORTS)?.query ?? [])).toMatchObject({
      'filter[account-id]': IDS.account,
    });
    expect(
      within(section()).getByRole('link', { name: 'All reports of this account' }),
    ).toHaveAttribute('href', `/reports?account-id=${IDS.account}`);
  });

  it('shows no section without reports:read', async () => {
    api.me({ permissions: ['accounts:read'] });

    await show();

    expect(screen.queryByRole('region', { name: 'Reports' })).toBeNull();
    expect(api.find('GET', REPORTS)).toBeUndefined();
  });
});
