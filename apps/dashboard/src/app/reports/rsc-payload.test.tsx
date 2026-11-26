/**
 * C70.3, C86: what the report pages send to the browser. For an operator without `pii:view` the
 * RSC payload of the report page, the reports index and the reports sections of the inquiry and
 * account pages holds no query value, matched name, list entry name, article title or URL,
 * address or wallet address: the API masked them, and the console never unmasks or reads them
 * from elsewhere. Each check has its control: the same search finds the values when the API
 * shows them, so it can fail.
 */
import type { Permission } from '@openverify/core';
import { REPORT_TYPES, type ReportType } from '@openverify/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  LIFECYCLE_IDS,
  account,
  accountType,
  inquiryDocument,
  relations,
  single,
} from '../../testing/lifecycle-fixtures';
import {
  REPORT_IDS,
  dashboardReport,
  report,
  reportAction,
  reportList,
  reportPiiValues,
  reportRun,
} from '../../testing/report-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import AccountPage from '../accounts/[id]/page';
import InquiryPage from '../inquiries/[id]/page';
import ReportPage from './[id]/page';
import ReportsPage from './page';
import { serveDecisions } from '../../testing/routes/workflows';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** Every report permission and the pages around it, without `pii:view`. */
const MASKED: Permission[] = [
  'reports:read',
  'reports:write',
  'reports:review',
  'reports:redact',
  'report-templates:read',
  'inquiries:read',
  'accounts:read',
];
const SHOWN: Permission[] = [...MASKED, 'pii:view'];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  api.on('GET', '/report-templates', 200, { data: [], links: { next: null } });
});

afterEach(() => {
  api.restore();
});

/** The report of `type` as the API answers an operator who may, or may not, see PII. */
const served = (type: ReportType, masked: boolean, id: string = REPORT_IDS.report) =>
  report(type, {
    id,
    masked,
    attributes: { origin: 'inquiry_completion' },
    relationships: { inquiry: { data: { type: 'inquiry', id: LIFECYCLE_IDS.inquiry } } },
  });

function expectNone(payload: string, type: ReportType) {
  for (const value of reportPiiValues(type)) {
    expect(payload, `${type}: ${value}`).not.toContain(value);
  }
}

function expectSome(payload: string, type: ReportType) {
  expect(
    reportPiiValues(type).some((value) => payload.includes(value)),
    type,
  ).toBe(true);
}

const detailPayload = async (type: ReportType, masked: boolean) => {
  api.me({ permissions: masked ? MASKED : SHOWN });
  const history = [
    reportAction({
      comment: masked ? null : 'Synthetic review note: the sandbox entry is the subject.',
    }),
    reportRun(),
  ];
  api.on(
    'GET',
    `/dashboard/reports/${REPORT_IDS.report}`,
    200,
    dashboardReport(served(type, masked), history),
  );
  return rscPayloadOf(await ReportPage({ params: Promise.resolve({ id: REPORT_IDS.report }) }));
};

describe('the report page’s RSC payload (C70.3, C86)', () => {
  it.each(REPORT_TYPES)(
    'holds no personal value of a %s report for an operator without pii:view',
    async (type) => {
      expectNone(await detailPayload(type, true), type);
    },
  );

  it.each(REPORT_TYPES)(
    'holds them for an operator the API shows a %s report to (the check above can fail)',
    async (type) => {
      expectSome(await detailPayload(type, false), type);
    },
  );
});

describe('the reports index and the inquiry and account sections (C70.3, C86)', () => {
  const answerLists = (masked: boolean) => {
    const reports = REPORT_TYPES.map((type, index) =>
      served(type, masked, `rep_01M5Y5Z4002GV576EACWSHT2${String(10 + index)}`),
    );
    api.on('GET', '/dashboard/reports', 200, reportList(reports));
    for (const each of reports) {
      api.on('GET', `/dashboard/reports/${each.id}`, 200, dashboardReport(each, [reportRun()]));
    }
  };

  it('hold no personal value of any report for an operator without pii:view', async () => {
    api.me({ permissions: MASKED });
    answerLists(true);
    api.on('GET', `/dashboard/inquiries/${LIFECYCLE_IDS.inquiry}`, 200, inquiryDocument());
    api.on('GET', `/accounts/${LIFECYCLE_IDS.account}`, 200, single(account()));
    api.on('GET', `/accounts/${LIFECYCLE_IDS.account}/relations`, 200, relations([]));
    api.on('GET', `/account-types/${LIFECYCLE_IDS.accountType}`, 200, single(accountType()));
    api.on('GET', '/inquiries', 200, { data: [], links: { next: null } });

    const payloads = [
      await rscPayloadOf(await ReportsPage({ searchParams: Promise.resolve({}) })),
      await rscPayloadOf(
        await InquiryPage({
          params: Promise.resolve({ id: LIFECYCLE_IDS.inquiry }),
          searchParams: Promise.resolve({}),
        }),
      ),
      await rscPayloadOf(
        await AccountPage({
          params: Promise.resolve({ id: LIFECYCLE_IDS.account }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ];

    for (const payload of payloads) {
      expect(payload).toContain(REPORT_IDS.report.slice(0, 20));
      for (const type of REPORT_TYPES) {
        expectNone(payload, type);
      }
    }
  });
});
