// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  REPORT_IDS,
  dashboardReport,
  report,
  reportList,
  reportRun,
} from '../../testing/report-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import {
  LINKED_REPORT_PAGE_SIZE,
  REPORT_PAGE_SIZE,
  getReport,
  listReports,
  loadLinkedReports,
} from './reports';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  api = routeApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('listReports (C72.3)', () => {
  it('reads one page of the masked dashboard list with every filter, as the session', async () => {
    api.on('GET', '/dashboard/reports', 200, reportList([report('watchlist')]));

    const page = await listReports(
      {
        types: ['report/watchlist'],
        statuses: ['errored'],
        result: 'no-match',
        tags: ['vip'],
        inquiryId: REPORT_IDS.inquiry,
      },
      REPORT_IDS.otherReport,
    );

    expect(page.data.map((each) => each.id)).toEqual([REPORT_IDS.report]);
    const request = api.find('GET', '/dashboard/reports');
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      'filter[type]': 'report/watchlist',
      'filter[status]': 'errored',
      'filter[has-match]': 'false',
      'filter[tag]': 'vip',
      'filter[inquiry-id]': REPORT_IDS.inquiry,
      'page[after]': REPORT_IDS.otherReport,
      'page[size]': String(REPORT_PAGE_SIZE),
    });
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('takes a page size for the inquiry and account sections', async () => {
    api.on('GET', '/dashboard/reports', 200, reportList([]));

    await listReports(
      { types: [], statuses: [], tags: [], accountId: REPORT_IDS.account },
      undefined,
      10,
    );

    expect(Object.fromEntries(api.find('GET', '/dashboard/reports')?.query ?? [])).toEqual({
      'filter[account-id]': REPORT_IDS.account,
      'page[size]': '10',
    });
  });
});

describe('getReport (C72.3)', () => {
  it('reads the masked report with its runs and actions', async () => {
    api.on(
      'GET',
      `/dashboard/reports/${REPORT_IDS.report}`,
      200,
      dashboardReport(report('watchlist'), [reportRun()]),
    );

    const document = await getReport(REPORT_IDS.report);

    expect(document.data.type).toBe('report/watchlist');
    expect(document.included?.map((entry) => entry.type)).toEqual(['report-run']);
  });
});

describe('loadLinkedReports (C70.5, C84.3)', () => {
  const completion = (id: string) =>
    report('watchlist', {
      id,
      attributes: { origin: 'inquiry_completion' },
      relationships: { inquiry: { data: { type: 'inquiry', id: REPORT_IDS.inquiry } } },
    });

  it('reads an inquiry’s reports, and which completion reports found it already decided', async () => {
    api
      .on(
        'GET',
        '/dashboard/reports',
        200,
        reportList(
          [
            completion(REPORT_IDS.report),
            completion(REPORT_IDS.otherReport),
            report('email-address', { id: 'rep_01M5Y5Z4002GV576EACWSHT2BN' }),
          ],
          '/api/v1/dashboard/reports?page%5Bafter%5D=rep_01M5Y5Z4002GV576EACWSHT2BN',
        ),
      )
      .on(
        'GET',
        `/dashboard/reports/${REPORT_IDS.report}`,
        200,
        dashboardReport(completion(REPORT_IDS.report), [
          reportRun({ notes: ['inquiry_already_decided'] }),
        ]),
      )
      .on(
        'GET',
        `/dashboard/reports/${REPORT_IDS.otherReport}`,
        200,
        dashboardReport(completion(REPORT_IDS.otherReport), [reportRun()]),
      );

    const linked = await loadLinkedReports({ inquiryId: REPORT_IDS.inquiry });

    expect(linked.reports).toHaveLength(3);
    expect(linked.decided).toEqual([REPORT_IDS.report]);
    expect(linked.more).toBe(true);
    expect(Object.fromEntries(api.find('GET', '/dashboard/reports')?.query ?? [])).toEqual({
      'filter[inquiry-id]': REPORT_IDS.inquiry,
      'page[size]': String(LINKED_REPORT_PAGE_SIZE),
    });
    // Only completion reports can find the inquiry decided: the API report was not read again.
    expect(api.find('GET', '/dashboard/reports/rep_01M5Y5Z4002GV576EACWSHT2BN')).toBeUndefined();
  });

  it('reads an account’s reports, home or linked, without reading each one', async () => {
    api.on('GET', '/dashboard/reports', 200, reportList([report('watchlist')]));

    const linked = await loadLinkedReports({ accountId: REPORT_IDS.account });

    expect(linked).toMatchObject({ decided: [], more: false });
    expect(Object.fromEntries(api.find('GET', '/dashboard/reports')?.query ?? [])).toEqual({
      'filter[account-id]': REPORT_IDS.account,
      'page[size]': String(LINKED_REPORT_PAGE_SIZE),
    });
    expect(api.requests).toHaveLength(1);
  });
});
