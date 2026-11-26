import { IMPORT_ERROR_CODES } from '@openverify/core';
import { REPORT_PROBLEM_CODES } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  ANALYTICS_IDS,
  BULK_REPORTER,
  reportBulkJob,
  serveReportBulkJob,
} from '../../../testing/routes/analytics';
import { BulkReportJob } from '../../../components/analytics/bulk-report-job';
import BulkReportsPage, { metadata } from './page';

vi.mock('next/navigation', async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('the bulk reports page (C166.5)', () => {
  it('needs reports:write', async () => {
    api.me({ permissions: ['reports:read'] });

    render(await BulkReportsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId('forbidden-panel')).toHaveTextContent('reports:write');
  });

  it('names the page and its limits', async () => {
    expect(metadata.title).toBe('Bulk reports');
    api.me({ permissions: BULK_REPORTER });
    api.on('GET', '/report-templates', 200, { data: [], links: { next: null } });

    render(await BulkReportsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Bulk reports' })).toBeVisible();
    expect(
      screen.getByText(/up to 1,000 reports from one CSV file of at most 2 MiB/),
    ).toBeVisible();
  });

  it('shows a job with every row’s outcome, a failed row reported failed', async () => {
    api.me({ permissions: ['reports:read', 'reports:write'] });
    serveReportBulkJob(api, reportBulkJob());

    render(
      await BulkReportsPage({ searchParams: Promise.resolve({ job: ANALYTICS_IDS.bulkJob }) }),
    );

    expect(screen.getByText(/1 created, 1 failed, of 2 rows/)).toBeVisible();
    const rows = screen.getByRole('table', { name: 'Rows and their outcomes' });
    expect(rows).toHaveTextContent('Failed');
    expect(rows).toHaveTextContent('report_query_invalid');
    expect(screen.getByRole('link', { name: ANALYTICS_IDS.report })).toHaveAttribute(
      'href',
      `/reports/${ANALYTICS_IDS.report}`,
    );
    // K9-20: without report-templates:read the list is unknown, so the form takes an ID.
    expect(screen.getByRole('textbox', { name: 'Report template ID' })).toBeVisible();
  });

  it('says a job still running is not done', async () => {
    api.me({ permissions: ['reports:read', 'reports:write'] });
    serveReportBulkJob(api, reportBulkJob({ status: 'running', rows: [] }));

    render(
      await BulkReportsPage({ searchParams: Promise.resolve({ job: ANALYTICS_IDS.bulkJob }) }),
    );

    expect(screen.getByText(/waiting or running: reload the page/)).toBeVisible();
  });
});

describe('a reports:write holder who cannot read report templates (K9-20)', () => {
  it('is offered a template ID field instead of the list, and the list is never read', async () => {
    api.me({ permissions: ['reports:read', 'reports:write'] });

    render(await BulkReportsPage({ searchParams: Promise.resolve({}) }));

    const form = screen.getByRole('form', { name: 'Upload a bulk report file' });
    expect(within(form).getByRole('textbox', { name: 'Report template ID' })).toHaveAttribute(
      'name',
      'report-template-id',
    );
    expect(screen.queryByText(/No active report template/)).toBeNull();
    expect(api.all('GET', '/report-templates')).toEqual([]);
  });

  it('refuses an ID that is not a report template ID in words, and sends nothing', async () => {
    api.me({ permissions: ['reports:read', 'reports:write'] });
    render(await BulkReportsPage({ searchParams: Promise.resolve({}) }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Report template ID' }), 'rep_123');
    await user.upload(
      screen.getByLabelText('CSV file'),
      new File(['name-first\nsynthetic'], 'people.csv', { type: 'text/csv' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload and create the reports' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Enter a report template ID: rptp_ and 26 letters and digits, as the template’s page shows it.',
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('a bulk row’s code in words (K9-21)', () => {
  const failedRow = (code: string) => ({
    row: 1,
    outcome: 'failed' as const,
    'report-id': null,
    'error-code': code,
  });

  it('says a failed row’s code in words, the code kept beside them', async () => {
    api.me({ permissions: ['reports:read', 'reports:write'] });
    serveReportBulkJob(api, reportBulkJob());

    render(
      await BulkReportsPage({ searchParams: Promise.resolve({ job: ANALYTICS_IDS.bulkJob }) }),
    );

    const rows = screen.getByRole('table', { name: 'Rows and their outcomes' });
    expect(rows).toHaveTextContent(
      'The query does not fit this report type. (report_query_invalid)',
    );
  });

  it.each([...REPORT_PROBLEM_CODES, ...IMPORT_ERROR_CODES])(
    'has words for %s, from the contracts’ code lists',
    (code) => {
      render(<BulkReportJob job={reportBulkJob({ rows: [failedRow(code)] })} />);

      const cell = within(screen.getByRole('table', { name: 'Rows and their outcomes' }))
        .getAllByRole('cell')
        .at(-1);
      expect(cell).toHaveTextContent(`(${code})`);
      expect(cell).not.toHaveTextContent('not described');
    },
  );

  it('shows an unknown code as itself, not described', () => {
    render(<BulkReportJob job={reportBulkJob({ rows: [failedRow('something_new')] })} />);

    expect(screen.getByRole('table', { name: 'Rows and their outcomes' })).toHaveTextContent(
      'something_new: not described',
    );
  });

  it('says a whole-file refusal in words, with its code', () => {
    render(
      <BulkReportJob
        job={reportBulkJob({ status: 'failed', rows: [], errorCode: 'report_bulk_file_refused' })}
      />,
    );

    expect(
      screen.getByText(/^The whole file was refused: .+\(report_bulk_file_refused\)\.?$/u),
    ).toBeVisible();
    expect(screen.queryByText(/not described/u)).toBeNull();
  });
});
