import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  TRANSACTION_DEVELOPER,
  TRANSACTION_REVIEWER,
  TRANSACTION_TYPE_VERSIONS_PATH,
  serveTransactionType,
  serveTransactionTypeVersion,
  serveTransactionTypeVersions,
} from '../../../testing/routes/transactions';
import {
  TRANSACTION_IDS,
  transactionType,
  transactionTypeVersion,
} from '../../../testing/transactions-fixtures';
import TransactionTypePage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const element = (id: string = TRANSACTION_IDS.type, searchParams: Record<string, string> = {}) =>
  TransactionTypePage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
const page = async (id?: string, searchParams?: Record<string, string>) =>
  render(<ToastProvider>{await element(id, searchParams)}</ToastProvider>);

const DRAFT = TRANSACTION_IDS.draft;
const PUBLISHED = 'txntpv_01M5CK3190XEVBM5ZXA76E1JS9';
const draftHref = `/transaction-types/${TRANSACTION_IDS.type}/versions/${DRAFT}`;

describe('a transaction type’s versions (K7B-3, C108)', () => {
  it('opens a type’s only draft by its latest-version relationship, and lists it', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionType(
      api,
      transactionType({ publishedVersion: null, latestVersion: 1, latestVersionId: DRAFT }),
    );
    const first = transactionTypeVersion({ number: 1 });
    serveTransactionTypeVersions(api, [first]);
    serveTransactionTypeVersion(api, first);

    await page();

    expect(screen.getByRole('link', { name: 'Open the latest draft' })).toHaveAttribute(
      'href',
      draftHref,
    );
    expect(screen.queryByRole('button', { name: 'New draft' })).toBeNull();
    const versions = screen.getByRole('table', { name: 'Versions' });
    expect(within(versions).getByRole('link', { name: 'Version 1' })).toHaveAttribute(
      'href',
      draftHref,
    );
    expect(versions).toHaveTextContent('Draft');
    expect(
      api.find('GET', TRANSACTION_TYPE_VERSIONS_PATH)?.query.get('filter[transaction-type-id]'),
    ).toBe(TRANSACTION_IDS.type);
  });

  it('lists a published and a draft version, and opens the draft', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionType(
      api,
      transactionType({ latestVersionId: DRAFT, publishedVersionId: PUBLISHED }),
    );
    const draft = transactionTypeVersion();
    serveTransactionTypeVersions(api, [
      draft,
      transactionTypeVersion({ id: PUBLISHED, number: 2, status: 'published' }),
    ]);
    serveTransactionTypeVersion(api, draft);

    await page();

    const rows = within(screen.getByRole('table', { name: 'Versions' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Version 3');
    expect(rows[1]).toHaveTextContent('Draft');
    expect(rows[2]).toHaveTextContent('Version 2');
    expect(rows[2]).toHaveTextContent('Published');
    expect(screen.getByRole('link', { name: 'Open the latest draft' })).toHaveAttribute(
      'href',
      draftHref,
    );
  });

  it('offers a new draft when the latest version is not a draft', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionType(
      api,
      transactionType({
        latestVersion: 2,
        latestVersionId: PUBLISHED,
        publishedVersionId: PUBLISHED,
      }),
    );
    serveTransactionTypeVersion(
      api,
      transactionTypeVersion({ id: PUBLISHED, number: 2, status: 'published' }),
    );

    await page();

    expect(screen.getByRole('button', { name: 'New draft' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open the latest draft' })).toBeNull();
  });

  it('lists the versions to a reader, with no draft action and no extra read', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });
    serveTransactionType(api, transactionType({ latestVersionId: DRAFT }));
    serveTransactionTypeVersions(api, [transactionTypeVersion()]);

    await page();

    expect(screen.getByRole('table', { name: 'Versions' })).toHaveTextContent('Version 3');
    expect(screen.queryByRole('link', { name: 'Open the latest draft' })).toBeNull();
    expect(api.all('GET', `${TRANSACTION_TYPE_VERSIONS_PATH}/${DRAFT}`)).toHaveLength(0);
  });

  it('pages the versions by cursor, ignoring one that is no version', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });
    serveTransactionType(api, transactionType());
    serveTransactionTypeVersions(
      api,
      [transactionTypeVersion()],
      `/api/v1/transaction-type-versions?page[after]=${PUBLISHED}`,
    );

    await page(undefined, { after: DRAFT });

    expect(api.find('GET', TRANSACTION_TYPE_VERSIONS_PATH)?.query.get('page[after]')).toBe(DRAFT);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/transaction-types/${TRANSACTION_IDS.type}?after=${PUBLISHED}`,
    );
  });
});

describe('one transaction type (C104, C108)', () => {
  it('shows the version numbers, the published fields, statuses and relations, read-only', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });
    serveTransactionType(api, transactionType());

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic order' })).toBeVisible();
    const versions = screen.getByRole('region', { name: 'Version history' });
    expect(within(versions).getByText('Latest version')).toBeVisible();
    expect(within(versions).getByText('v3')).toBeVisible();
    expect(within(versions).getByText('v2')).toBeVisible();
    expect(within(versions).queryByText(/No route lists/)).toBeNull();
    const published = screen.getByRole('region', { name: 'Published version' });
    expect(within(published).getByRole('table', { name: 'Fields' })).toHaveTextContent('note');
    expect(within(published).getByRole('list', { name: 'Statuses' })).toHaveTextContent(
      'needs review',
    );
    expect(within(published).getByRole('table', { name: 'Relations' })).toHaveTextContent('payer');
    expect(screen.queryByRole('button', { name: 'New draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive type' })).toBeNull();
  });

  it('offers a new draft, the name and archiving with transaction-types:write', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionType(api, transactionType({ publishedVersion: null, latestVersion: 1 }));

    await page();

    expect(screen.getByRole('button', { name: 'New draft' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Archive type' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Rename the type' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Published version' })).getByText(
        'No version is published yet, so no transaction can be created with this type.',
      ),
    ).toBeVisible();
  });

  it('answers not found for an id that is not a type id', async () => {
    api.me({ permissions: TRANSACTION_REVIEWER });

    await expect(element('nope')).rejects.toThrow();
  });
});

describe('a transaction type’s adverse statuses and contest route (C122.1, C128.3; Workflow 8D)', () => {
  it('lists the adverse statuses and the contest route in words, with a form to change them', async () => {
    api.me({ permissions: TRANSACTION_DEVELOPER });
    serveTransactionType(api, transactionType());
    const first = transactionTypeVersion({ number: 1 });
    serveTransactionTypeVersions(api, [first]);
    serveTransactionTypeVersion(api, first);

    await page();

    const adverse = screen.getByText('Adverse statuses', { selector: 'dt' }).nextElementSibling;
    expect(adverse).toHaveTextContent('declined');
    const route = screen.getByText('Contest route', { selector: 'dt' }).nextElementSibling;
    expect(route).toHaveTextContent('Not declared');
    expect(screen.getByRole('form', { name: 'Decisions on this type' })).toBeVisible();
  });
});
