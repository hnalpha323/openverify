import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  THEME_EDITOR,
  THEME_IDS,
  THEME_SETS_PATH,
  THEME_VIEWER,
  serveThemeSets,
  themeSetResource,
} from '../../testing/routes/themes-copy';
import ThemeSetsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: THEME_VIEWER });
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => ThemeSetsPage({ searchParams: Promise.resolve(params) });
const query = () => Object.fromEntries(api.find('GET', THEME_SETS_PATH)?.query ?? []);

describe('the theme sets index (C160.1)', () => {
  it('is titled Theme sets', () => {
    expect(metadata.title).toBe('Theme sets');
  });

  it('lists the sets newest first as the API answers: name, status in words, revision and the default', async () => {
    serveThemeSets(api, [
      themeSetResource({ name: 'Synthetic Brand', revision: 4, isDefault: true }),
      themeSetResource({
        id: THEME_IDS.archivedSet,
        name: 'Synthetic Old',
        status: 'archived',
      }),
    ]);

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Theme sets' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Theme sets' });
    const rows = within(table).getAllByRole('row').slice(1);
    const [brandRow, oldRow] = rows;
    if (brandRow === undefined || oldRow === undefined) {
      throw new Error('expected two rows');
    }
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Synthetic Brand',
      'Synthetic Old',
    ]);
    const brand = within(brandRow);
    expect(brand.getByRole('link', { name: 'Synthetic Brand' })).toHaveAttribute(
      'href',
      `/theme-sets/${THEME_IDS.set}`,
    );
    expect(brand.getByText('Active')).toBeVisible();
    expect(brand.getByText('4')).toBeVisible();
    expect(brand.getByText('Default set')).toBeVisible();
    expect(within(oldRow).getByText('Archived')).toBeVisible();
    expect(query()).toEqual({ 'page[size]': '25' });
  });

  it('passes the status filter and the cursor, keeps them on the next page, and ignores a bad value', async () => {
    serveThemeSets(api, [], `/api/v1/theme-sets?page%5Bafter%5D=${THEME_IDS.otherSet}`);

    render(await page({ status: 'archived', after: THEME_IDS.set }));

    expect(query()).toEqual({
      'filter[status]': 'archived',
      'page[size]': '25',
      'page[after]': THEME_IDS.set,
    });
    expect(screen.getByRole('cell')).toHaveTextContent('No theme sets match this filter.');
    const next = new URL(
      screen.getByRole('link', { name: 'Next page' }).getAttribute('href') ?? '',
      'http://dashboard.test',
    );
    expect(next.searchParams.get('status')).toBe('archived');
    expect(next.searchParams.get('after')).toBe(THEME_IDS.otherSet);

    render(await page({ status: 'gone', after: 'nope' }));
    expect(query()).toEqual({ 'page[size]': '25' });
  });

  it('says when there is no set yet, and offers creation only with theme-sets:write', async () => {
    serveThemeSets(api, []);
    render(await page());
    expect(screen.getByRole('heading', { name: 'No theme sets yet' })).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Create a theme set' })).toBeNull();

    api.me({ permissions: THEME_EDITOR });
    render(await page());
    expect(screen.getByRole('form', { name: 'Create a theme set' })).toBeVisible();
  });

  it('shows the forbidden panel without theme-sets:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByText(/theme-sets:read/)).toBeVisible();
    expect(api.find('GET', THEME_SETS_PATH)).toBeUndefined();
  });
});
