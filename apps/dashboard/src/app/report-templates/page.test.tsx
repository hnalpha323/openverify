import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  REPORT_CONFIG_IDS as IDS,
  TEMPLATE_NAME,
  reportTemplate,
} from '../../testing/report-config-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  CONFIG_VIEWER,
  REPORT_TEMPLATES_PATH,
  CONFIG_EDITOR,
  serveReportTemplates,
} from '../../testing/routes/report-config';
import ReportTemplatesPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

const MEDIA = reportTemplate({
  id: IDS.mediaTemplate,
  name: 'Synthetic media screening',
  type: 'adverse-media',
  status: 'archived',
  versionNumber: 3,
  config: {},
});

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CONFIG_VIEWER });
  serveReportTemplates(api, [reportTemplate(), MEDIA]);
});

afterEach(() => {
  api.restore();
});

const page = (params: Record<string, string> = {}) =>
  ReportTemplatesPage({ searchParams: Promise.resolve(params) });

function rowOf(name: string): HTMLElement {
  const row = within(screen.getByRole('table', { name: 'Report templates' }))
    .getByRole('rowheader', { name })
    .closest('tr');
  if (row === null) {
    throw new Error(`no row ${name}`);
  }
  return row;
}

describe('the report templates page (C71, C86)', () => {
  it('lists the templates with their type, status and current version', async () => {
    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Report templates' })).toBeVisible();
    const row = rowOf(TEMPLATE_NAME);
    expect(within(row).getByRole('link', { name: TEMPLATE_NAME })).toHaveAttribute(
      'href',
      `/report-templates/${IDS.template}`,
    );
    expect(row).toHaveTextContent('Watchlist');
    expect(within(row).getByText('Active')).toHaveAttribute('data-status', 'active');
    expect(row).toHaveTextContent('Version 1');
    const media = rowOf('Synthetic media screening');
    expect(media).toHaveTextContent('Adverse media');
    expect(within(media).getByText('Archived')).toHaveAttribute('data-status', 'archived');
    expect(media).toHaveTextContent('Version 3');
  });

  it('filters by type and status through the API, keeping the filters in the next page link', async () => {
    serveReportTemplates(
      api,
      [MEDIA],
      `/api/v1/report-templates?filter%5Breport-type%5D=adverse-media&page%5Bafter%5D=${IDS.mediaTemplate}`,
    );

    render(await page({ type: 'adverse-media', status: 'archived' }));

    expect(Object.fromEntries(api.find('GET', REPORT_TEMPLATES_PATH)?.query ?? [])).toEqual({
      'filter[report-type]': 'adverse-media',
      'filter[status]': 'archived',
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter report templates' });
    expect(within(filters).getByRole('combobox', { name: 'Type' })).toHaveValue('adverse-media');
    expect(within(filters).getByRole('combobox', { name: 'Status' })).toHaveValue('archived');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/report-templates?type=adverse-media&status=archived&after=${IDS.mediaTemplate}`,
    );
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/report-templates',
    );
  });

  it('ignores a filter value the API does not know, and a malformed cursor', async () => {
    render(await page({ type: 'credit-check', status: 'gone', after: 'rptp_x' }));

    expect(Object.fromEntries(api.find('GET', REPORT_TEMPLATES_PATH)?.query ?? [])).toEqual({
      'page[size]': '25',
    });
  });

  it('pages with the cursor', async () => {
    render(await page({ after: IDS.otherTemplate }));

    expect(api.find('GET', REPORT_TEMPLATES_PATH)?.query.get('page[after]')).toBe(
      IDS.otherTemplate,
    );
  });

  it('says when there are no templates, and when none matches the filters', async () => {
    serveReportTemplates(api, []);

    render(await page());
    expect(screen.getByRole('heading', { name: 'No report templates yet' })).toBeVisible();
  });

  it('says when no template matches the filters', async () => {
    serveReportTemplates(api, []);

    render(await page({ type: 'phone-number' }));
    expect(
      screen.getByRole('heading', { name: 'No template matches these filters' }),
    ).toBeVisible();
  });

  it('carries only what the API returned in its RSC payload, from the one list route', async () => {
    const payload = await rscPayloadOf(await page());

    expect(payload).toContain(TEMPLATE_NAME);
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /dashboard/me',
      `GET ${REPORT_TEMPLATES_PATH}`,
    ]);
  });

  it('shows the forbidden panel without report-templates:read, without listing', async () => {
    api.me({ permissions: ['watchlists:read', 'reports:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(screen.getByTestId('forbidden-panel')).toHaveTextContent('report-templates:read');
    expect(api.find('GET', REPORT_TEMPLATES_PATH)).toBeUndefined();
  });

  it('sends the operator to sign in when the session has ended', async () => {
    api.onProblem('GET', REPORT_TEMPLATES_PATH, 401);

    await expect(redirectTarget(page())).resolves.toBe('/login');
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Report templates');
  });

  it('links a writer to the new template form, and offers a reader none (C153.4)', async () => {
    api.me({ permissions: CONFIG_EDITOR });
    render(await page());

    expect(screen.getByRole('link', { name: 'New report template' })).toHaveAttribute(
      'href',
      '/report-templates/new',
    );
  });

  it('offers a reader no new template link', async () => {
    render(await page());

    expect(screen.queryByRole('link', { name: 'New report template' })).toBeNull();
  });
});
