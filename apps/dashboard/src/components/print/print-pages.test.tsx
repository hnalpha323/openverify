/**
 * C173.3 on the three pages: each carries its print mark, its Print button and its printed footer,
 * the footer saying "contains personal data" only to a reader with `pii:view`.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InquiryPage from '../../app/inquiries/[id]/page';
import ReportPage from '../../app/reports/[id]/page';
import VerificationPage from '../../app/verifications/[id]/page';
import { CASES_REPORTS_COPY } from '../../lib/copy/cases-reports';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  governmentIdVerification,
  inquiryDocument,
} from '../../testing/lifecycle-fixtures';
import { REPORT_IDS, dashboardReport, report } from '../../testing/report-fixtures';
import { serveDecisions } from '../../testing/routes/workflows';
import { ToastProvider } from '../toasts';

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

const show = (node: React.ReactNode) => render(<ToastProvider>{node}</ToastProvider>);

describe('the print views of the inquiry, report and verification pages (C173.3)', () => {
  it('marks the inquiry page for print, offers its Print button and its footer', async () => {
    api.me({ permissions: ['inquiries:read', 'pii:view'] });
    serveDecisions(api, []);
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument());

    const { container } = show(
      await InquiryPage({
        params: Promise.resolve({ id: IDS.inquiry }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(container.querySelector('[data-inquiry-print]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeVisible();
    expect(container.querySelector('[data-inquiry-print-footer]')).toHaveTextContent(
      CASES_REPORTS_COPY.print.containsPersonalData,
    );
  });

  it('marks the report page for print, the footer saying personal data is masked without pii:view', async () => {
    api.me({ permissions: ['reports:read'] });
    api.on(
      'GET',
      `/dashboard/reports/${REPORT_IDS.report}`,
      200,
      dashboardReport(report('watchlist', { masked: true })),
    );

    const { container } = show(
      await ReportPage({ params: Promise.resolve({ id: REPORT_IDS.report }) }),
    );

    expect(container.querySelector('[data-report-print]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeVisible();
    expect(container.querySelector('[data-report-print-footer]')).toHaveTextContent(
      CASES_REPORTS_COPY.print.masked,
    );
  });

  it('marks the verification page for print and shows its files by metadata, without inquiries:read', async () => {
    api.me({ permissions: ['verifications:read'] });
    api.on('GET', `/verifications/${IDS.governmentId}`, 200, {
      data: governmentIdVerification({ 'redacted-at': '2026-11-01T09:00:00.000Z' }),
      included: [
        {
          type: 'file',
          id: IDS.front,
          attributes: {
            kind: 'front',
            'mime-type': 'image/jpeg',
            'byte-size': 2048,
            'created-at': '2026-10-30T09:00:00.000Z',
          },
          relationships: {
            verification: {
              data: { type: 'verification/government-id', id: IDS.governmentId },
            },
          },
        },
      ],
    });

    const { container } = show(
      await VerificationPage({ params: Promise.resolve({ id: IDS.governmentId }) }),
    );

    expect(container.querySelector('[data-verification-print]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeVisible();
    expect(api.all('GET', `/verifications/${IDS.governmentId}`)[0]?.query.get('include')).toBe(
      'files',
    );
    const files = screen.getByRole('table', { name: 'File metadata' });
    expect(files).toHaveTextContent(IDS.front);
    expect(files).toHaveTextContent('image/jpeg');
    expect(screen.getByRole('status', { name: 'Redacted' })).toBeVisible();
  });
});
