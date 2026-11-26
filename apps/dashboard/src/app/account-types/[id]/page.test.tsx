import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, accountType, single } from '../../../testing/lifecycle-fixtures';
import { expectNotFound, redirectTarget } from '../../../testing/next-errors';
import AccountTypeError from './error';
import AccountTypeLoading from './loading';
import AccountTypePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TYPE = `/account-types/${IDS.otherAccountType}`;
const SCHEMA = {
  legal_name: { type: 'string', label: 'Legal name' },
  founded: { type: 'date', label: 'Founded on' },
} as const;

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['accounts:read', 'accounts:write'] });
  api.on('GET', TYPE, 200, single(accountType('business', IDS.otherAccountType, SCHEMA)));
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const page = (id: string = IDS.otherAccountType) =>
  AccountTypePage({ params: Promise.resolve({ id }) });

async function renderType() {
  render(<ToastProvider>{await page()}</ToastProvider>);
}

describe('account type page (C26)', () => {
  it('shows the type with its fields', async () => {
    await renderType();

    expect(screen.getByRole('heading', { level: 1, name: 'business' })).toBeVisible();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Account types' })).toHaveAttribute(
      'href',
      '/account-types',
    );
    const fields = screen.getByRole('table', { name: 'Fields of business' });
    const row = within(fields).getByRole('rowheader', { name: 'founded' }).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Founded on')).toBeVisible();
    expect(within(row).getByText('Date')).toBeVisible();
    expect(screen.getByText(IDS.otherAccountType)).toBeVisible();
  });

  it('offers the edit form with accounts:write, bound to the session environment (Workflow 2D F002)', async () => {
    api.me({
      permissions: ['accounts:read', 'accounts:write'],
      environment: ENVIRONMENTS.production,
    });

    await renderType();

    const form = screen.getByRole('form', { name: 'Edit the account type' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('business');
    expect(new FormData(form as HTMLFormElement).get('environment-id')).toBe(
      ENVIRONMENTS.production.id,
    );
  });

  it('offers no edit form without accounts:write', async () => {
    api.me({ permissions: ['accounts:read'] });

    await renderType();

    expect(screen.queryByRole('form', { name: 'Edit the account type' })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Fields of business' })).toBeVisible();
  });

  it('says when the type has no fields', async () => {
    api.on('GET', TYPE, 200, single(accountType('plain', IDS.otherAccountType, {})));

    await renderType();

    expect(screen.getByText('This type has no fields yet.')).toBeVisible();
  });

  it('shows the forbidden panel without accounts:read, without reading the type', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', TYPE)).toBeUndefined();
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('acc_01JB0000000000000000000001'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not show it to this session', async () => {
    api.onProblem('GET', TYPE, 404);

    await expectNotFound(page());
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', TYPE, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Account type');
  });
});

describe('account type loading and error states', () => {
  it('announces that the type is loading', () => {
    render(<AccountTypeLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the account type…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<AccountTypeError error={new Error('socket hang up')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The account type could not be loaded.');
    expect(screen.queryByText(/socket/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('an account type’s contest route (C128.3; Workflow 8D)', () => {
  it('says when no contest route is declared, and offers one in the edit form', async () => {
    await renderType();

    const route = screen.getByText('Contest route', { selector: 'dt' }).nextElementSibling;
    expect(route).toHaveTextContent('Not declared');
    expect(screen.getByRole('textbox', { name: /Contest route URL/ })).toBeVisible();
  });
});
