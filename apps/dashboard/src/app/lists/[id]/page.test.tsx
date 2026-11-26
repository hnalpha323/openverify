import { render, screen, within } from '@testing-library/react';
import type { Permission } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIST_IDS,
  emailItem,
  importer,
  listItem,
  listResource,
} from '../../../testing/lists-fixtures';
import { rscPayloadOf } from '../../../testing/rsc-payload';
import {
  IMPORTERS_PATH,
  LIST_ADMIN,
  LIST_ITEMS_PATH,
  LIST_REVIEWER,
  LIST_VIEWER,
  serveImporters,
  serveList,
  serveListItems,
  serveListSettings,
} from '../../../testing/routes/lists';
import ListPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const VALUE = 'blocked.sender@mail.example';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const as = (permissions: readonly Permission[]) => api.me({ permissions });
const element = (id: string = LIST_IDS.list, params: Record<string, string> = {}) =>
  ListPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(params) });
const page = async (id?: string, params?: Record<string, string>) =>
  render(<ToastProvider>{await element(id, params)}</ToastProvider>);
const items = () => screen.getByRole('table', { name: 'Items' });
const query = (path: string) => Object.fromEntries(api.find('GET', path)?.query ?? []);

function serveEmailList(masked: boolean) {
  serveList(api, listResource('email-address'));
  serveListItems(api, [
    emailItem({ attributes: masked ? { value: null } : {}, matchCount: 2 }),
    emailItem({
      id: LIST_IDS.otherItem,
      status: 'archived',
      attributes: { value: null, 'match-type': 'domain' },
      redacted: true,
    }),
  ]);
  serveImporters(api, [importer('email-address', { status: 'errored', errorCount: 2 })]);
}

describe('one list (C97, C108)', () => {
  it('shows the list, and its items with their values to an operator with pii:view', async () => {
    as(LIST_ADMIN);
    serveEmailList(false);

    await page();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Synthetic blocked senders' }),
    ).toBeVisible();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('Email address')).toBeVisible();
    expect(within(details).getByText('v3')).toBeVisible();
    expect(within(details).getByText('Kept until removed')).toBeVisible();
    const active = within(items()).getByRole('rowheader', { name: LIST_IDS.item }).closest('tr');
    expect(active).not.toBeNull();
    expect(within(active as HTMLElement).getByText(VALUE)).toBeVisible();
    expect(within(active as HTMLElement).getByText('Whole address')).toBeVisible();
    expect(query(LIST_ITEMS_PATH)).toEqual({
      'filter[list-id]': LIST_IDS.list,
      'page[size]': '25',
    });
    const redacted = within(items())
      .getByRole('rowheader', { name: LIST_IDS.otherItem })
      .closest('tr');
    expect(within(redacted as HTMLElement).getByText('Redacted')).toBeVisible();
    expect(within(redacted as HTMLElement).getByText('Archived')).toBeVisible();
  });

  it('shows Hidden for every value without pii:view, and the RSC payload holds none', async () => {
    as(LIST_VIEWER);
    serveEmailList(true);

    await page();

    const active = within(items()).getByRole('rowheader', { name: LIST_IDS.item }).closest('tr');
    expect(within(active as HTMLElement).getByText('Hidden')).toBeVisible();
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(await rscPayloadOf(await element())).not.toContain(VALUE);

    // The control: the same search finds the value when the API shows it.
    serveEmailList(false);
    expect(await rscPayloadOf(await element())).toContain(VALUE);
  });

  it('offers an item form, archiving and the import form to an administrator', async () => {
    as(LIST_ADMIN);
    serveEmailList(false);

    await page();

    const add = screen.getByRole('form', { name: 'Add an item' });
    expect(within(add).getByRole('textbox', { name: /^Email address/u })).toBeRequired();
    expect(within(add).getByRole('combobox', { name: 'Match' })).toHaveValue('email_address');
    expect(
      within(items()).getByRole('button', { name: `Archive item ${LIST_IDS.item}` }),
    ).toBeVisible();
    expect(
      within(items()).queryByRole('button', { name: `Archive item ${LIST_IDS.otherItem}` }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive list' })).toBeVisible();
    const upload = screen.getByRole('form', { name: 'Import a CSV file' });
    expect(within(upload).getByLabelText(/^CSV file/u)).toBeRequired();
    expect(within(upload).getByRole('combobox', { name: 'Mode' })).toHaveValue('all-or-nothing');
  });

  it("lists the list's imports with their progress, and links each one", async () => {
    as(LIST_REVIEWER);
    serveEmailList(false);

    await page();

    expect(query(IMPORTERS_PATH)).toEqual({ 'filter[list-id]': LIST_IDS.list, 'page[size]': '25' });
    const imports = screen.getByRole('table', { name: 'Imports' });
    const row = within(imports).getByRole('rowheader', { name: LIST_IDS.importer }).closest('tr');
    expect(
      within(row as HTMLElement).getByRole('link', { name: LIST_IDS.importer }),
    ).toHaveAttribute('href', `/lists/importers/${LIST_IDS.importer}`);
    expect(within(row as HTMLElement).getByText('Errored')).toBeVisible();
    expect(within(row as HTMLElement).getByText('0 of 3 rows imported; 2 errors')).toBeVisible();
  });

  it('tells a reviewer that importing needs importers:write and lists:write', async () => {
    as(LIST_REVIEWER);
    serveEmailList(false);

    await page();

    expect(screen.queryByRole('form', { name: 'Import a CSV file' })).toBeNull();
    expect(
      screen.getByText('Importing a file needs importers:write and lists:write.'),
    ).toBeVisible();
  });

  it('offers nothing to change to a viewer, and asks nothing of the importers without importers:read', async () => {
    as(['lists:read']);
    serveEmailList(true);

    await page();

    expect(screen.queryByRole('form', { name: 'Add an item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive list' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Edit the list' })).toBeNull();
    expect(api.find('GET', IMPORTERS_PATH)).toBeUndefined();
  });

  it('says an archived list stops matching and takes no item', async () => {
    as(LIST_ADMIN);
    serveList(api, listResource('email-address', { status: 'archived' }));
    serveListItems(api, []);
    serveImporters(api, []);

    await page();

    expect(
      screen.getByText('This list is archived: it stops matching, and keeps its items readable.'),
    ).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Add an item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive list' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Import a CSV file' })).toBeNull();
  });

  it('shows a face list with its retention, its items by source inquiry, and no importer', async () => {
    as(LIST_ADMIN);
    serveList(api, listResource('face', { id: LIST_IDS.faceList, itemRetentionDays: 90 }));
    serveListSettings(api, 'Synthetic basis: fraud prevention under our DPIA.', 180);
    serveListItems(api, [
      listItem('face', {
        id: 'lifc_01JC0000000000000000000001',
        listId: LIST_IDS.faceList,
        status: 'pending',
        attributes: { model: null, 'source-inquiry-id': LIST_IDS.inquiry },
      }),
    ]);

    await page(LIST_IDS.faceList);

    expect(
      within(screen.getByRole('region', { name: 'Details' })).getByText('90 days'),
    ).toBeVisible();
    expect(within(items()).getByText('Pending (not matched yet)')).toBeVisible();
    expect(within(items()).getByRole('link', { name: LIST_IDS.inquiry })).toHaveAttribute(
      'href',
      `/inquiries/${LIST_IDS.inquiry}`,
    );
    expect(
      within(screen.getByRole('form', { name: 'Add an item' })).getByRole('textbox', {
        name: /^Inquiry ID/u,
      }),
    ).toBeRequired();
    expect(screen.getByRole('spinbutton', { name: /^Item retention \(days\)/u })).toHaveAttribute(
      'max',
      '180',
    );
    expect(api.find('GET', IMPORTERS_PATH)).toBeUndefined();
    expect(
      screen.getByText(
        'Face and background lists have no importer: add each item from an inquiry.',
      ),
    ).toBeVisible();
  });

  it('offers the next page of items, keeping the cursor in the URL', async () => {
    as(LIST_VIEWER);
    serveList(api, listResource('email-address'));
    serveListItems(
      api,
      [emailItem({ attributes: { value: null } })],
      `/api/v1/list-items?page%5Bafter%5D=${LIST_IDS.item}`,
    );
    serveImporters(api, []);

    await page(LIST_IDS.list, { after: LIST_IDS.otherItem });

    expect(query(LIST_ITEMS_PATH)['page[after]']).toBe(LIST_IDS.otherItem);
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/lists/${LIST_IDS.list}?after=${LIST_IDS.item}`,
    );
  });

  it('answers not found for an id that is not a list id', async () => {
    as(LIST_VIEWER);

    await expect(element('nope')).rejects.toThrow();
    expect(api.find('GET', `/lists/nope`)).toBeUndefined();
  });

  it('shows the forbidden panel without lists:read', async () => {
    as(['inquiries:read']);

    await page();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });
});

describe('a list’s purpose (C122.1; Workflow 8D)', () => {
  it('says the purpose in words, and that adding to a block list is an adverse step', async () => {
    as(LIST_ADMIN);
    serveEmailList(false);

    await page();

    const purpose = screen.getByText('Purpose', { selector: 'dt' }).nextElementSibling;
    expect(purpose).toHaveTextContent(/Block/);
    expect(purpose).toHaveTextContent(/adverse/);
    expect(screen.getByRole('combobox', { name: 'Purpose' })).toHaveValue('block');
  });
});
