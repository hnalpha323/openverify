import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  inquiry,
  inquiryList,
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound, redirectTarget } from '../../../testing/next-errors';
import AccountPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ACCOUNT = `/accounts/${IDS.account}`;
const REVIEWER: Permission[] = [
  'inquiries:read',
  'accounts:read',
  'accounts:write',
  'accounts:redact',
  'pii:view',
];
const VIEWER: Permission[] = ['inquiries:read', 'accounts:read'];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: REVIEWER });
  api.on('GET', ACCOUNT, 200, single(account()));
  api.on(
    'GET',
    `${ACCOUNT}/relations`,
    200,
    relations([
      {},
      {
        direction: 'incoming',
        'related-account': { type: 'account', id: IDS.thirdAccount },
        'relation-type': 'business_owner',
      },
    ]),
  );
  api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
  api.on('GET', '/inquiries', 200, inquiryList([inquiry()]));
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.account, searchParams: Record<string, string> = {}) =>
  AccountPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

async function renderAccount(searchParams: Record<string, string> = {}) {
  render(<ToastProvider>{await page(IDS.account, searchParams)}</ToastProvider>);
}

const region = (name: string) => screen.getByRole('region', { name });
const actionButtons = () =>
  screen.queryByRole('group', { name: 'Account actions' }) === null
    ? []
    : within(screen.getByRole('group', { name: 'Account actions' }))
        .getAllByRole('button')
        .map((button) => button.textContent);

describe('account detail page', () => {
  it('shows the account with its status, type and details', async () => {
    await renderAccount();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`Account ${IDS.account}`);
    expect(screen.getAllByText('Active', { selector: '[data-status]' })[0]).toBeVisible();
    const details = region('Details');
    expect(within(details).getByText('acct-ref-001')).toBeVisible();
    expect(within(details).getByText('user')).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Accounts',
      }),
    ).toHaveAttribute('href', '/accounts');
  });

  it("labels the fields with the account type's schema", async () => {
    await renderAccount();

    const fields = region('Fields');
    expect(within(fields).getByText('First name')).toBeVisible();
    expect(within(fields).getByText('Synthetic')).toBeVisible();
    expect(within(fields).getByRole('button', { name: 'Edit fields' })).toBeVisible();
  });

  it('offers archive, consolidate and redact to an operator with accounts:*', async () => {
    await renderAccount();

    expect(actionButtons()).toEqual(['Archive', 'Consolidate', 'Redact']);
  });

  it('offers restore for an archived account and names the account it was consolidated into', async () => {
    api.on(
      'GET',
      ACCOUNT,
      200,
      single(account({ status: 'archived', 'consolidated-into': IDS.otherAccount })),
    );

    await renderAccount();

    expect(actionButtons()).toEqual(['Restore', 'Redact']);
    const notice = screen.getByRole('status', { name: 'Consolidated' });
    expect(within(notice).getByRole('link', { name: IDS.otherAccount })).toHaveAttribute(
      'href',
      `/accounts/${IDS.otherAccount}`,
    );
  });

  it('shows a viewer "Hidden" fields and no controls', async () => {
    api.me({ permissions: VIEWER });
    api.on('GET', ACCOUNT, 200, single(account({ fields: { name_first: null } })));

    await renderAccount();

    expect(actionButtons()).toEqual([]);
    expect(within(region('Fields')).getByText('Hidden')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Edit|Add|Remove/ })).toBeNull();
  });

  it('lists the relations in both directions, removable with accounts:write', async () => {
    await renderAccount();

    const table = within(region('Relations')).getByRole('table', { name: 'Account relations' });
    expect(within(table).getByRole('link', { name: IDS.otherAccount })).toBeVisible();
    expect(within(table).getByText('From this account')).toBeVisible();
    expect(within(table).getByText('To this account')).toBeVisible();
    // Each row action names its relation (Workflow 2E F014).
    expect(
      within(table).getAllByRole('button', { name: /^Remove the \w+ relation / }),
    ).toHaveLength(2);
    expect(within(region('Relations')).getByRole('button', { name: 'Add relation' })).toBeVisible();
  });

  it("lists the account's inquiries from the dashboard API, removable with accounts:write", async () => {
    await renderAccount({ after: IDS.thirdInquiry });

    const inquiries = region('Inquiries');
    expect(within(inquiries).getByRole('link', { name: IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
    expect(within(inquiries).getByRole('button', { name: 'Remove' })).toBeVisible();
    expect(within(inquiries).getByRole('button', { name: 'Add inquiries' })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', '/inquiries')?.query ?? [])).toEqual({
      'filter[account-id]': IDS.account,
      'page[after]': IDS.thirdInquiry,
      'page[size]': '25',
    });
  });

  it('lists the inquiry ids of the account without inquiries:read', async () => {
    api.me({ permissions: ['accounts:read'] });

    await renderAccount();

    expect(within(region('Inquiries')).getByText(IDS.inquiry)).toBeVisible();
    expect(api.find('GET', '/inquiries')).toBeUndefined();
  });

  it('shows the redacted state', async () => {
    api.on(
      'GET',
      ACCOUNT,
      200,
      single(account({ 'redacted-at': '2026-10-20T05:00:00.000Z', fields: {} })),
    );

    await renderAccount();

    expect(screen.getByRole('status', { name: 'Redacted' })).toHaveTextContent(
      'This account was redacted',
    );
    expect(within(region('Fields')).getByText('Redacted')).toBeVisible();
    expect(actionButtons()).toEqual(['Archive', 'Consolidate']);
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('acc_x'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not show it', async () => {
    api.onProblem('GET', ACCOUNT, 404);

    await expectNotFound(page());
  });

  it('shows the forbidden panel without accounts:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', ACCOUNT)).toBeUndefined();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', ACCOUNT, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Account');
  });
});
