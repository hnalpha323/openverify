import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { LIST_IDS, listResource } from '../../testing/lists-fixtures';
import { LISTS_PATH, serveLists } from '../../testing/routes/lists';
import ListsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['lists:read'] });
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => ListsPage({ searchParams: Promise.resolve(params) });
const listQuery = () => Object.fromEntries(api.find('GET', LISTS_PATH)?.query ?? []);
const rowOf = (name: string) => {
  const table = screen.getByRole('table', { name: 'Lists' });
  const row = within(table).getByRole('rowheader', { name: name }).closest('tr');
  if (row === null) {
    throw new Error(`no row for ${name}`);
  }
  return within(row);
};

describe('the lists index (C108)', () => {
  it('is titled Lists', () => {
    expect(metadata.title).toBe('Lists');
  });

  it("lists the environment's lists: name, type, status, item count and version", async () => {
    serveLists(api, [
      listResource('email-address', { itemCount: 1234, version: 7 }),
      listResource('face', {
        id: LIST_IDS.faceList,
        name: 'Synthetic face list',
        status: 'archived',
      }),
    ]);

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toBeVisible();
    const email = rowOf('Synthetic blocked senders');
    expect(email.getByRole('link', { name: 'Synthetic blocked senders' })).toHaveAttribute(
      'href',
      `/lists/${LIST_IDS.list}`,
    );
    expect(email.getByText('Email address')).toBeVisible();
    expect(email.getByText('Active')).toBeVisible();
    expect(email.getByText('1,234')).toBeVisible();
    expect(email.getByText('v7')).toBeVisible();
    const face = rowOf('Synthetic face list');
    expect(face.getByText('Face')).toBeVisible();
    expect(face.getByText('Archived')).toBeVisible();
    expect(listQuery()).toEqual({ 'page[size]': '25' });
  });

  it('passes the type (as its singular kind) and status filters, and keeps them on the next page', async () => {
    serveLists(api, [], `/api/v1/lists?page%5Bafter%5D=${LIST_IDS.otherList}`);

    render(await page({ type: 'email-address', status: 'archived' }));

    expect(listQuery()).toEqual({
      'filter[type]': 'email-address',
      'filter[status]': 'archived',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter lists' });
    expect(within(filters).getByRole('combobox', { name: 'Type' })).toHaveValue('email-address');
    expect(within(filters).getByRole('combobox', { name: 'Status' })).toHaveValue('archived');
    expect(screen.getByRole('cell')).toHaveTextContent('No lists match these filters.');
    const next = new URL(
      screen.getByRole('link', { name: 'Next page' }).getAttribute('href') ?? '',
      'http://dashboard.test',
    );
    expect(next.pathname).toBe('/lists');
    expect(next.searchParams.get('type')).toBe('email-address');
    expect(next.searchParams.get('after')).toBe(LIST_IDS.otherList);
  });

  it('ignores a filter value the API would refuse', async () => {
    serveLists(api, []);

    render(await page({ type: 'lists', status: 'gone', after: 'nope' }));

    expect(listQuery()).toEqual({ 'page[size]': '25' });
  });

  it('says when the environment has no list yet, and offers Create list with lists:write', async () => {
    api.me({ permissions: ['lists:read', 'lists:write'] });
    serveLists(api, []);

    render(await page());

    expect(screen.getByRole('heading', { name: 'No lists yet' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Create list' })).toHaveAttribute('href', '/lists/new');
  });

  it('offers no creation without lists:write', async () => {
    serveLists(api, []);

    render(await page());

    expect(screen.queryByRole('link', { name: 'Create list' })).toBeNull();
  });

  it('shows the forbidden panel without lists:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', LISTS_PATH)).toBeUndefined();
  });
});
