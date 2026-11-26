import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, inquiryDocument } from '../../../testing/lifecycle-fixtures';
import { dashboardReport, report, reportList, reportRun } from '../../../testing/report-fixtures';
import InquiryPage from './page';
import { serveDecisions } from '../../../testing/routes/workflows';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const REPORTS = '/dashboard/reports';
const DECIDED = 'rep_01M5Y5Z4002GV576EACWSHT2BP';
const ERRORED = 'rep_01M5Y5Z4002GV576EACWSHT2BQ';
const READER: Permission[] = ['inquiries:read', 'reports:read'];
let api: RouteApi;

const linked = (id: string, attributes: Record<string, unknown> = {}) =>
  report('watchlist', {
    id,
    attributes: { origin: 'inquiry_completion', ...attributes },
    relationships: { inquiry: { data: { type: 'inquiry', id: IDS.inquiry } } },
  });
const decided = linked(DECIDED);
const errored = linked(ERRORED, {
  status: 'errored',
  'has-match': false,
  matches: [],
  'matched-lists': [],
  errors: [{ code: 'list_stale', source: 'openverify-sandbox' }],
});

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.me({ permissions: READER });
  api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument());
  api.on(
    'GET',
    `${REPORTS}/${DECIDED}`,
    200,
    dashboardReport(decided, [reportRun({ notes: ['inquiry_already_decided'] })]),
  );
  api.on(
    'GET',
    `${REPORTS}/${ERRORED}`,
    200,
    dashboardReport(errored, [
      reportRun({
        status: 'errored',
        errors: [{ code: 'list_stale', source: 'openverify-sandbox' }],
      }),
    ]),
  );
});

afterEach(() => {
  api.restore();
});

const show = async () => {
  render(
    <ToastProvider>
      {await InquiryPage({
        params: Promise.resolve({ id: IDS.inquiry }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );
};
const section = () => screen.getByRole('region', { name: 'Reports' });

describe('the reports section of the inquiry page (C70.5, C84.3, C86)', () => {
  it('lists the inquiry’s reports, an errored one as not screened, and says which were decided before they finished', async () => {
    api.on('GET', REPORTS, 200, reportList([decided, errored]));

    await show();

    const table = within(section()).getByRole('table', { name: 'Reports of this inquiry' });
    const decidedRow = within(
      within(table).getByRole('rowheader', { name: DECIDED }).closest('tr') as HTMLElement,
    );
    expect(decidedRow.getByText('Match')).toBeVisible();
    expect(decidedRow.getByText('Decided before this report finished')).toBeVisible();
    const erroredRow = within(
      within(table).getByRole('rowheader', { name: ERRORED }).closest('tr') as HTMLElement,
    );
    expect(erroredRow.getByText('Not screened')).toBeVisible();
    expect(erroredRow.queryByText('Decided before this report finished')).toBeNull();
    expect(Object.fromEntries(api.find('GET', REPORTS)?.query ?? [])).toMatchObject({
      'filter[inquiry-id]': IDS.inquiry,
    });
    expect(section()).toHaveTextContent('decided without them');
  });

  it('links every report of the inquiry when the section shows only the first ones', async () => {
    api.on(
      'GET',
      REPORTS,
      200,
      reportList([decided], `/api/v1/dashboard/reports?page%5Bafter%5D=${DECIDED}`),
    );

    await show();

    expect(
      within(section()).getByRole('link', { name: 'All reports of this inquiry' }),
    ).toHaveAttribute('href', `/reports?inquiry-id=${IDS.inquiry}`);
  });

  it('says when the inquiry has no report', async () => {
    api.on('GET', REPORTS, 200, reportList([]));

    await show();

    expect(section()).toHaveTextContent('No report is linked to this inquiry.');
  });

  it('shows the section’s forbidden panel when the API refuses the reports, and the rest of the page', async () => {
    api.onProblem('GET', REPORTS, 403, 'forbidden');

    await show();

    expect(
      within(section()).getByRole('heading', { name: 'You do not have access' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Details' })).toBeVisible();
  });

  it('shows no section, and asks nothing, without reports:read', async () => {
    api.me({ permissions: ['inquiries:read'] });

    await show();

    expect(screen.queryByRole('region', { name: 'Reports' })).toBeNull();
    expect(api.find('GET', REPORTS)).toBeUndefined();
  });
});
