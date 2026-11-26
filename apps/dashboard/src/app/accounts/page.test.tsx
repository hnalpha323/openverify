import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, account, accountType } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import AccountsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['accounts:read'] });
  api.on('GET', '/accounts', 200, {
    data: [
      account(),
      account(
        { status: 'archived', 'reference-id': null, tags: [], 'consolidated-into': IDS.account },
        IDS.otherAccount,
        [],
      ),
    ],
    links: { next: null },
  });
  api.on('GET', '/account-types', 200, {
    data: [accountType('user'), accountType('business', IDS.otherAccountType)],
    links: { next: null },
  });
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => AccountsPage({ searchParams: Promise.resolve(params) });
const query = (path: string) => Object.fromEntries(api.find('GET', path)?.query ?? []);

describe('accounts page', () => {
  it('lists the accounts with their type, status and tags', async () => {
    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Accounts' });
    const row = within(table).getByRole('rowheader', { name: IDS.account }).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByRole('link', { name: IDS.account })).toHaveAttribute(
      'href',
      `/accounts/${IDS.account}`,
    );
    expect(within(row).getByText('acct-ref-001')).toBeVisible();
    expect(within(row).getByText('user')).toBeVisible();
    expect(within(row).getByText('Active')).toHaveAttribute('data-status', 'active');
    expect(within(row).getByText('vip')).toBeVisible();
    expect(within(table).getByText('Archived')).toBeVisible();
    expect(query('/accounts')).toEqual({ 'page[size]': '25' });
    expect(query('/account-types')).toEqual({ 'page[size]': '100' });
  });

  it('passes the filters of the URL to the API and shows them in the form', async () => {
    render(
      await page({
        status: 'archived',
        'account-type-id': IDS.otherAccountType,
        tag: 'vip',
        'reference-id': 'acct-ref-001',
        'created-from': '2026-10-01',
        'created-to': '2026-10-01',
        after: IDS.thirdAccount,
      }),
    );

    expect(query('/accounts')).toEqual({
      'filter[status]': 'archived',
      'filter[account-type-id]': IDS.otherAccountType,
      'filter[tag]': 'vip',
      'filter[reference-id]': 'acct-ref-001',
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-02T00:00:00.000Z',
      'page[size]': '25',
      'page[after]': IDS.thirdAccount,
    });
    const form = screen.getByRole('search', { name: 'Filter accounts' });
    expect(within(form).getByRole('combobox', { name: 'Status' })).toHaveValue('archived');
    expect(within(form).getByRole('combobox', { name: 'Account type' })).toHaveValue(
      IDS.otherAccountType,
    );
    expect(within(form).getByRole('option', { name: 'business' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First page' }).getAttribute('href')).toContain(
      'status=archived',
    );
  });

  it("links to the next page from the API's cursor", async () => {
    api.on('GET', '/accounts', 200, {
      data: [account()],
      links: { next: `/api/v1/accounts?page%5Bsize%5D=25&page%5Bafter%5D=${IDS.account}` },
    });

    render(await page());

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/accounts?after=${IDS.account}`,
    );
  });

  it('says how accounts appear when there are none', async () => {
    api.on('GET', '/accounts', 200, { data: [], links: { next: null } });

    render(await page());

    expect(screen.getByRole('heading', { name: 'No accounts yet' })).toBeVisible();
  });

  it('explains a filter the API would refuse instead of listing', async () => {
    render(await page({ tag: '<b>' }));

    expect(api.find('GET', '/accounts')).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the filters');
    expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the chosen status and type in the form while another filter is explained (Workflow 2D F003)', async () => {
    render(await page({ status: 'archived', 'account-type-id': IDS.otherAccountType, tag: '<b>' }));

    expect(api.find('GET', '/accounts')).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('archived');
    expect(screen.getByRole('combobox', { name: 'Account type' })).toHaveValue(
      IDS.otherAccountType,
    );
  });

  it('shows the forbidden panel without accounts:read, without listing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', '/accounts')).toBeUndefined();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', '/accounts', 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Accounts');
  });
});
