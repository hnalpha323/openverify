/**
 * C173.1 (Phase 6 decision 25): the inquiry's reports section reads at most 25 reports and at most
 * 10 of them in full for their runs, newest first; a completion report past the tenth is read only
 * as the masked list answered it, through its latest run's notes, and the section says so.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, inquiryDocument } from '../../../testing/lifecycle-fixtures';
import { dashboardReport, report, reportList, reportRun } from '../../../testing/report-fixtures';
import { serveDecisions } from '../../../testing/routes/workflows';
import InquiryPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const REPORTS = '/dashboard/reports';
const SUFFIX = '0123456789AB';
const idOf = (index: number) => `rep_01M5Y5Z4002GV576EACWSHT2${SUFFIX[index] ?? '0'}0`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.me({ permissions: ['inquiries:read', 'reports:read'] });
  api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument());
});

afterEach(() => {
  api.restore();
});

const linked = (index: number, latest?: readonly string[]) =>
  report('watchlist', {
    id: idOf(index),
    attributes: {
      origin: 'inquiry_completion',
      ...(latest === undefined ? {} : { 'latest-run-notes': latest }),
    },
    relationships: { inquiry: { data: { type: 'inquiry', id: IDS.inquiry } } },
  });

describe('the inquiry’s reports within Phase 6 decision 25’s bounds (C173.1)', () => {
  it('reads at most ten reports in full, reads the rest by their latest run’s notes, and says so', async () => {
    const reports = Array.from({ length: 12 }, (_, index) =>
      linked(index, index === 11 ? ['inquiry_already_decided'] : []),
    );
    api.on('GET', REPORTS, 200, reportList(reports));
    for (const [index, each] of reports.entries()) {
      api.on(
        'GET',
        `${REPORTS}/${each.id}`,
        200,
        dashboardReport(each, [
          reportRun({ notes: index === 1 ? ['inquiry_already_decided'] : [] }),
        ]),
      );
    }

    render(
      <ToastProvider>
        {await InquiryPage({
          params: Promise.resolve({ id: IDS.inquiry }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    const detailReads = api.requests.filter(
      (request) => request.method === 'GET' && request.path.startsWith(`${REPORTS}/`),
    );
    expect(detailReads.map((request) => request.path)).toEqual(
      reports.slice(0, 10).map((each) => `${REPORTS}/${each.id}`),
    );
    const section = within(screen.getByRole('region', { name: 'Reports' }));
    const rowOf = (index: number) =>
      within(section.getByRole('rowheader', { name: idOf(index) }).closest('tr') as HTMLElement);
    expect(rowOf(1).getByText('Decided before this report finished')).toBeVisible();
    expect(rowOf(11).getByText('Decided before this report finished')).toBeVisible();
    expect(rowOf(10).queryByText('Decided before this report finished')).toBeNull();
    expect(section.getByText(CASES_REPORTS_COPY.reports.detailReadsCapped)).toBeVisible();
  });

  it('says nothing of a cap when ten or fewer completion reports are read', async () => {
    api.on('GET', REPORTS, 200, reportList([linked(0)]));
    api.on('GET', `${REPORTS}/${idOf(0)}`, 200, dashboardReport(linked(0), [reportRun()]));

    render(
      <ToastProvider>
        {await InquiryPage({
          params: Promise.resolve({ id: IDS.inquiry }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(screen.queryByText(CASES_REPORTS_COPY.reports.detailReadsCapped)).toBeNull();
  });
});
