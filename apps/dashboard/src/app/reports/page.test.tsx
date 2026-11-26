import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  REPORT_IDS,
  pendingReport,
  report,
  reportList,
  reportTemplate,
  reportTemplateList,
} from '../../testing/report-fixtures';
import { serveReportTemplatePages } from '../../testing/routes/report-config';
import ReportsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const LIST = '/dashboard/reports';
const TEMPLATES = '/report-templates';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['reports:read'] });
});

afterEach(() => {
  api.restore();
});

type Params = Record<string, string | string[] | undefined>;
const page = (params: Params = {}) => ReportsPage({ searchParams: Promise.resolve(params) });
const listQuery = () => Object.fromEntries(api.find('GET', LIST)?.query ?? []);
const table = () => screen.getByRole('table', { name: 'Reports' });
const rowOf = (id: string) => {
  const row = within(table()).getByRole('rowheader', { name: id }).closest('tr');
  if (row === null) {
    throw new Error(`no row for ${id}`);
  }
  return within(row);
};

describe('the reports index (C86)', () => {
  it('is titled Reports', () => {
    expect(metadata.title).toBe('Reports');
  });

  it("lists the environment's reports: type, status, result beside its coverage, version, origin, tags and creation", async () => {
    api.on('GET', LIST, 200, reportList([report('watchlist')]));

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    const row = rowOf(REPORT_IDS.report);
    expect(row.getByRole('link', { name: REPORT_IDS.report })).toHaveAttribute(
      'href',
      `/reports/${REPORT_IDS.report}`,
    );
    expect(row.getByText('Watchlist')).toBeVisible();
    expect(row.getByText('Ready')).toBeVisible();
    expect(row.getByText('Match')).toBeVisible();
    expect(row.getByText('Complete')).toBeVisible();
    expect(row.getByText('v1')).toBeVisible();
    expect(row.getByText('API')).toBeVisible();
    expect(row.getByText('onboarding')).toBeVisible();
    expect(row.getByText('Oct 27, 2026, 9:00 AM')).toBeVisible();
    expect(listQuery()).toEqual({ 'page[size]': '25' });
  });

  it('reads an errored report as not screened, never as no match (C69.4)', async () => {
    api.on(
      'GET',
      LIST,
      200,
      reportList([
        report('watchlist', {
          attributes: {
            status: 'errored',
            'has-match': false,
            matches: [],
            'matched-lists': [],
            errors: [{ code: 'list_stale', source: 'openverify-sandbox' }],
          },
        }),
      ]),
    );

    render(await page());

    const row = rowOf(REPORT_IDS.report);
    expect(row.getByText('Errored (not screened)')).toBeVisible();
    expect(row.getByText('Not screened')).toBeVisible();
    expect(row.queryByText(/no match/i)).toBeNull();
  });

  it('keeps a partial run’s match beside its errors, never as clear (H01)', async () => {
    api.on(
      'GET',
      LIST,
      200,
      reportList([
        report('watchlist', {
          attributes: {
            status: 'errored',
            errors: [{ code: 'list_unavailable', source: 'eu-fsf' }],
          },
        }),
      ]),
    );

    render(await page());

    expect(rowOf(REPORT_IDS.report).getByText('Match; not fully screened')).toBeVisible();
  });

  it('shows a no match only beside ready, with the coverage and its limits beside it', async () => {
    api.on(
      'GET',
      LIST,
      200,
      reportList([
        report('watchlist', {
          attributes: {
            'has-match': false,
            matches: [],
            'matched-lists': [],
            coverage: { complete: false, limits: ['lossy_script'] },
          },
        }),
        pendingReport('email-address', { id: REPORT_IDS.otherReport }),
      ]),
    );

    render(await page());

    const ready = rowOf(REPORT_IDS.report);
    expect(ready.getByText('No match')).toBeVisible();
    expect(ready.getByText('Limited: lossy script')).toBeVisible();
    const pending = rowOf(REPORT_IDS.otherReport);
    expect(pending.getByText('Not run yet')).toBeVisible();
    expect(pending.queryByText('No match')).toBeNull();
  });

  it('reads a ready report of a type without matches as computed', async () => {
    api.on('GET', LIST, 200, reportList([report('phone-number')]));

    render(await page());

    expect(rowOf(REPORT_IDS.report).getByText('Fields computed')).toBeVisible();
  });

  it('passes the filters and cursor of the URL to the API, shows them in the form and keeps them on the next page', async () => {
    api.on(
      'GET',
      LIST,
      200,
      reportList([], `/api/v1/dashboard/reports?page%5Bafter%5D=${REPORT_IDS.otherReport}`),
    );

    render(
      await page({
        type: ['report/watchlist', 'report/adverse-media'],
        status: 'errored',
        result: 'match',
        template: REPORT_IDS.template,
        tag: 'vip',
        'account-id': REPORT_IDS.account,
        'inquiry-id': REPORT_IDS.inquiry,
      }),
    );

    expect(listQuery()).toEqual({
      'filter[type]': 'report/watchlist,report/adverse-media',
      'filter[status]': 'errored',
      'filter[has-match]': 'true',
      'filter[report-template-id]': REPORT_IDS.template,
      'filter[tag]': 'vip',
      'filter[account-id]': REPORT_IDS.account,
      'filter[inquiry-id]': REPORT_IDS.inquiry,
      'page[size]': '25',
    });
    const filters = screen.getByRole('search', { name: 'Filter reports' });
    expect(within(filters).getByRole('checkbox', { name: 'Watchlist' })).toBeChecked();
    expect(within(filters).getByRole('checkbox', { name: 'Email address' })).not.toBeChecked();
    expect(within(filters).getByRole('checkbox', { name: 'Errored (not screened)' })).toBeChecked();
    expect(within(filters).getByRole('combobox', { name: 'Result' })).toHaveValue('match');
    expect(within(filters).getByRole('textbox', { name: 'Report template ID' })).toHaveValue(
      REPORT_IDS.template,
    );
    expect(within(filters).getByRole('textbox', { name: 'Inquiry ID' })).toHaveValue(
      REPORT_IDS.inquiry,
    );
    expect(screen.getByRole('cell')).toHaveTextContent('No reports match these filters.');
    const next = new URL(
      screen.getByRole('link', { name: 'Next page' }).getAttribute('href') ?? '',
      'http://dashboard.test',
    );
    expect(next.pathname).toBe('/reports');
    expect(next.searchParams.getAll('type')).toEqual(['report/watchlist', 'report/adverse-media']);
    expect(next.searchParams.get('result')).toBe('match');
    expect(next.searchParams.get('after')).toBe(REPORT_IDS.otherReport);
  });

  it('says no match lists only screened reports, in the result filter (C69.4)', async () => {
    api.on('GET', LIST, 200, reportList([]));

    render(await page());

    const result = screen.getByRole('combobox', { name: 'Result' });
    expect(
      within(result).getByRole('option', { name: 'No match (ready reports only)' }),
    ).toHaveValue('no-match');
  });

  it('explains a typed filter the API would refuse, and lists nothing until it is corrected', async () => {
    render(await page({ 'account-id': 'acc_1', type: 'report/watchlist' }));

    expect(api.find('GET', LIST)).toBeUndefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the filters');
    expect(screen.getByRole('textbox', { name: 'Account ID' })).toHaveAccessibleDescription(
      'Enter an account ID: acc_ followed by 26 letters and digits.',
    );
    expect(screen.getByRole('checkbox', { name: 'Watchlist' })).toBeChecked();
  });

  it('says when the environment has no report yet', async () => {
    api.on('GET', LIST, 200, reportList([]));

    render(await page());

    expect(screen.getByRole('heading', { name: 'No reports yet' })).toBeVisible();
  });

  it('offers a template list to an operator who reads templates, and Create report to one who writes reports', async () => {
    api.me({ permissions: ['reports:read', 'reports:write', 'report-templates:read'] });
    api.on('GET', LIST, 200, reportList([report('watchlist')]));
    api.on(
      'GET',
      TEMPLATES,
      200,
      reportTemplateList([reportTemplate('watchlist', { name: 'Synthetic sanctions screening' })]),
    );

    render(await page({ template: REPORT_IDS.template }));

    const template = screen.getByRole('combobox', { name: 'Report template' });
    expect(
      within(template).getByRole('option', { name: 'Synthetic sanctions screening (Watchlist)' }),
    ).toHaveValue(REPORT_IDS.template);
    expect(template).toHaveValue(REPORT_IDS.template);
    expect(Object.fromEntries(api.find('GET', TEMPLATES)?.query ?? [])).toEqual({
      'page[size]': '100',
    });
    expect(screen.getByRole('link', { name: 'Create report' })).toHaveAttribute(
      'href',
      '/reports/new',
    );
    expect(rowOf(REPORT_IDS.report).getByRole('link', { name: 'v1' })).toHaveAttribute(
      'href',
      `/report-templates/${REPORT_IDS.template}`,
    );
  });

  // Workflow 6B R013: the filter read only the first 100 templates, and silently left out the rest.
  it('offers the templates of every page in the template filter, and says when it stops at 1,000', async () => {
    api.me({ permissions: ['reports:read', 'report-templates:read'] });
    api.on('GET', LIST, 200, reportList([report('watchlist')]));
    const templateId = (n: number) => `rptp_01M5Y5Z400VF5JFP7ER3C4${String(n).padStart(4, '0')}`;
    const pageOf = (from: number, count = 100) =>
      Array.from({ length: count }, (_, index) =>
        reportTemplate('watchlist', {
          id: templateId(from + index),
          name: `T${String(from + index)}`,
        }),
      );
    const filter = () =>
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Report template' });

    serveReportTemplatePages(api, [pageOf(0, 1), pageOf(1, 1)]);
    const { unmount } = render(await page());
    expect([...filter().options].map((option) => option.value)).toEqual([
      '',
      templateId(0),
      templateId(1),
    ]);
    expect(filter()).not.toHaveAccessibleDescription();
    unmount();

    serveReportTemplatePages(
      api,
      Array.from({ length: 11 }, (_, index) => pageOf(index * 100)),
    );
    render(await page());
    expect(filter().options).toHaveLength(1_001);
    expect(filter()).toHaveAccessibleDescription('Only the first 1,000 templates are listed.');
  });

  it('asks nothing of the templates without report-templates:read, and offers no creation without reports:write', async () => {
    api.on('GET', LIST, 200, reportList([report('watchlist')]));

    render(await page());

    expect(api.find('GET', TEMPLATES)).toBeUndefined();
    expect(screen.getByRole('textbox', { name: 'Report template ID' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create report' })).toBeNull();
    expect(rowOf(REPORT_IDS.report).queryByRole('link', { name: 'v1' })).toBeNull();
  });

  it('shows the forbidden panel without reports:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', LIST)).toBeUndefined();
  });
});
