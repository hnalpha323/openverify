import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, accountType } from '../../testing/lifecycle-fixtures';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import AccountTypesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['accounts:read', 'accounts:write'] });
  api.on('GET', '/account-types', 200, {
    data: [
      accountType('user'),
      accountType('business', IDS.otherAccountType, {
        legal_name: { type: 'string', label: 'Legal name' },
        founded: { type: 'date', label: 'Founded on' },
      }),
    ],
    links: { next: null },
  });
});

afterEach(() => {
  api.restore();
});

const page = (params: Record<string, string> = {}) =>
  AccountTypesPage({ searchParams: Promise.resolve(params) });

async function renderTypes(params: Record<string, string> = {}) {
  render(<ToastProvider>{await page(params)}</ToastProvider>);
}

describe('account types page', () => {
  it('lists the account types with the fields each one takes', async () => {
    await renderTypes();

    expect(screen.getByRole('heading', { level: 1, name: 'Account types' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Account types' });
    const row = within(table).getByRole('rowheader', { name: 'business' }).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText(IDS.otherAccountType)).toBeVisible();
    // Each type opens its own page (C26).
    expect(within(row).getByRole('link', { name: 'business' })).toHaveAttribute(
      'href',
      `/account-types/${IDS.otherAccountType}`,
    );
    const fields = within(row).getByRole('list', { name: 'Fields of business' });
    expect(
      within(fields)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Legal name (legal_name, string)', 'Founded on (founded, date)']);
    expect(Object.fromEntries(api.find('GET', '/account-types')?.query ?? [])).toEqual({
      'page[size]': '25',
    });
  });

  it('offers the creation form with accounts:write', async () => {
    await renderTypes();

    const form = screen.getByRole('form', { name: 'New account type' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: 'Fields schema' })).toBeVisible();
  });

  it('binds the creation form to the session environment (Workflow 2D F002)', async () => {
    api.me({
      permissions: ['accounts:read', 'accounts:write'],
      environment: ENVIRONMENTS.production,
    });

    await renderTypes();

    const form = screen.getByRole('form', { name: 'New account type' });
    expect(new FormData(form as HTMLFormElement).get('environment-id')).toBe(
      ENVIRONMENTS.production.id,
    );
  });

  it('offers no creation form without accounts:write', async () => {
    api.me({ permissions: ['accounts:read'] });

    await renderTypes();

    expect(screen.queryByRole('form', { name: 'New account type' })).not.toBeInTheDocument();
  });

  it('says how a type may change: fields added and labels changed, never removed (C25.3)', async () => {
    await renderTypes();

    expect(screen.getByText(/Open a type to add fields or change their labels/)).toBeVisible();
    expect(screen.queryByText(/cannot be changed once it is created/)).not.toBeInTheDocument();
  });

  it('pages with the C1 cursor', async () => {
    api.on('GET', '/account-types', 200, {
      data: [accountType()],
      links: { next: `/api/v1/account-types?page%5Bafter%5D=${IDS.accountType}` },
    });

    await renderTypes({ after: IDS.otherAccountType });

    expect(api.find('GET', '/account-types')?.query.get('page[after]')).toBe(IDS.otherAccountType);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/account-types?after=${IDS.accountType}`,
    );
  });

  it('says when there are no account types', async () => {
    api.on('GET', '/account-types', 200, { data: [], links: { next: null } });

    await renderTypes();

    expect(screen.getByRole('heading', { name: 'No account types yet' })).toBeVisible();
  });

  it('shows the forbidden panel without accounts:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', '/account-types')).toBeUndefined();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', '/account-types', 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Account types');
  });
});
