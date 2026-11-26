import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ANALYTICS_IDS,
  INQUIRY_EXPORTER,
  exportResource,
  savedView,
  serveExports,
} from '../../testing/routes/analytics';
import ExportsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const page = async (params: Record<string, string> = {}) =>
  render(await ExportsPage({ searchParams: Promise.resolve(params) }));

describe('the exports page (C166)', () => {
  it('says which permissions export, and asks nothing, without any of them', async () => {
    api.me({ permissions: ['inquiries:read'] });

    await page();

    expect(screen.getByTestId('forbidden-panel')).toBeVisible();
    expect(screen.getByText(/one of these permissions/)).toHaveTextContent('inquiries:export');
    expect(api.all('GET', '/exports')).toEqual([]);
  });

  it('offers a new export of the types held, a saved view chosen by id', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });
    serveExports(api, []);
    api.on('GET', '/dashboard/saved-views', 200, {
      data: [savedView()],
      links: { next: null },
    });

    await page({ view: ANALYTICS_IDS.view, type: 'inquiries' });

    const form = within(screen.getByRole('form', { name: 'New export' }));
    expect(form.getAllByRole('option').map((option) => option.textContent)).toEqual(['Inquiries']);
    expect(form.getByText(/the filters of your saved view “Failed this month”/)).toBeVisible();
    expect(api.find('GET', '/dashboard/saved-views')?.query.get('filter[list]')).toBe('inquiries');
    expect(screen.getByText(/keeps their data until the file is deleted/)).toBeVisible();
    expect(screen.getByText(/more than 50,000 rows is refused, never cut short/)).toBeVisible();
  });

  it('ignores a view chosen for a type the operator cannot export', async () => {
    api.me({ permissions: INQUIRY_EXPORTER });
    serveExports(api, []);

    await page({ view: ANALYTICS_IDS.view, type: 'accounts' });

    expect(api.all('GET', '/dashboard/saved-views')).toEqual([]);
  });

  it('lists the caller’s own exports', async () => {
    expect(metadata.title).toBe('Exports');
    api.me({ permissions: INQUIRY_EXPORTER });
    serveExports(api, [
      exportResource(),
      exportResource({ id: ANALYTICS_IDS.otherExport, status: 'failed' }),
    ]);

    await page();

    expect(screen.getByRole('heading', { level: 1, name: 'Exports' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Your exports' });
    const row = within(
      within(table)
        .getByRole('rowheader', { name: ANALYTICS_IDS.export })
        .closest('tr') as HTMLElement,
    );
    expect(row.getByText('120 rows, filtered by filter[status]')).toBeVisible();
    expect(row.getByText('Personal data masked')).toBeVisible();
    expect(row.getByRole('link', { name: `Download ${ANALYTICS_IDS.export}` })).toHaveAttribute(
      'href',
      `/exports/${ANALYTICS_IDS.export}/download`,
    );
    const failed = within(
      within(table)
        .getByRole('rowheader', { name: ANALYTICS_IDS.otherExport })
        .closest('tr') as HTMLElement,
    );
    expect(failed.getByText(/Refused: more than 50,000 rows \(never cut short\)/)).toBeVisible();
    expect(failed.queryByRole('link')).toBeNull();
  });
});
