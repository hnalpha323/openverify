/**
 * `dashboard-analytics`' mock routes and fixtures (Workflow 9C, C164.8, C165, C166): the six
 * analytics answers, saved views, exports and bulk report jobs, registered on a `routeApi()` the
 * test made. Paths are after `/api/v1`. Every value is synthetic, and every answer is built to pass
 * its contract schema (suppressed counts included), so a test reads what the API could serve.
 */
import type {
  AnalyticsCasesDocument,
  AnalyticsChecksDocument,
  AnalyticsFunnelDocument,
  AnalyticsInquiriesDocument,
  AnalyticsSignalsDocument,
  AnalyticsVerificationsDocument,
  ExportResource,
  ReportBulkJobResource,
  SavedViewResource,
} from '@openverify/contracts';
import type {
  AnalyticsReport,
  ExportObjectType,
  Permission,
  SavedViewList,
} from '@openverify/core';
import type { RouteApi } from '../api-routes';

export const ANALYTICS_PATH = '/analytics';
export const EXPORTS_PATH = '/exports';
export const SAVED_VIEWS_PATH = '/dashboard/saved-views';
export const REPORTS_BULK_PATH = '/reports/bulk';

/** Reads analytics, as every built-in role but admin's narrower ones. */
export const ANALYTICS_READER: readonly Permission[] = ['analytics:read'];
/** Reads analytics and may see cases per reviewer (users:write, review P20). */
export const ANALYTICS_MANAGER: readonly Permission[] = ['analytics:read', 'users:write'];
/** Exports inquiries without personal data. */
export const INQUIRY_EXPORTER: readonly Permission[] = ['inquiries:read', 'inquiries:export'];
/** Exports inquiries and may include personal data. */
export const INQUIRY_EXPORTER_PII: readonly Permission[] = [...INQUIRY_EXPORTER, 'pii:view'];
/** Creates bulk reports. */
export const BULK_REPORTER: readonly Permission[] = [
  'reports:read',
  'reports:write',
  'report-templates:read',
];

export const ANALYTICS_IDS = Object.freeze({
  template: 'itmpl_01JF0000000000000000000001',
  version: 'itmplv_01JF0000000000000000000002',
  otherVersion: 'itmplv_01JF0000000000000000000003',
  caseTemplate: 'ctmpl_01JF0000000000000000000004',
  reviewer: 'usr_01JF0000000000000000000005',
  export: 'exp_01JF0000000000000000000006',
  otherExport: 'exp_01JF0000000000000000000007',
  view: 'svw_01JF0000000000000000000008',
  sharedView: 'svw_01JF0000000000000000000009',
  owner: 'usr_01J9ZK3M5Q7R8S9T0V1W2X3Y46',
  otherOwner: 'usr_01JF0000000000000000000010',
  bulkJob: 'rbulk_01JF0000000000000000000011',
  reportTemplate: 'rptp_01JF0000000000000000000012',
  report: 'rep_01JF0000000000000000000013',
  list: 'lst_01JF0000000000000000000014',
});

const ANSWER_ID = 'a'.repeat(64);
export const ANALYTICS_FROM = '2026-10-01';
export const ANALYTICS_TO = '2026-10-03';
export const ROLLED_UP_THROUGH = '2026-10-03T11:55:00.000Z';
export const OUTCOMES_AS_OF = '2026-10-03T00:05:00.000Z';

export interface AnswerOptions {
  readonly zone?: string;
  readonly zones?: readonly string[];
  readonly threshold?: number;
  readonly suppressedCells?: number;
  readonly rolledUpThrough?: string | null;
  readonly outcomesAsOf?: string | null;
  readonly bucket?: 'day' | 'week' | 'month';
}

function attributesOf(options: AnswerOptions) {
  const zone = options.zone ?? 'UTC';
  return {
    'time-zone': zone,
    'time-zones': [...(options.zones ?? [zone])],
    from: ANALYTICS_FROM,
    to: ANALYTICS_TO,
    bucket: options.bucket ?? 'day',
    threshold: options.threshold ?? 11,
    'suppressed-cells': options.suppressedCells ?? 0,
    'settle-days': 30,
    freshness: {
      'rolled-up-through':
        options.rolledUpThrough === undefined ? ROLLED_UP_THROUGH : options.rolledUpThrough,
      'outcomes-as-of': options.outcomesAsOf === undefined ? OUTCOMES_AS_OF : options.outcomesAsOf,
    },
  };
}

const days = ['2026-10-01', '2026-10-02', '2026-10-03'] as const;
const bucketOf = (day: string, live = false, zone = 'UTC') => ({
  start: day,
  end: day,
  'time-zone': zone,
  live,
});

/** `GET /analytics/inquiries`: two stored days and today live; one small count hidden. */
export function inquiriesAnswer(options: AnswerOptions = {}): AnalyticsInquiriesDocument {
  const counts = {
    created: 40,
    started: 30,
    interacted: 28,
    finished: 24,
    completed: 20,
    'completed-verified': 12,
    'completed-with-fallback': { suppressed: 'small-count' as const },
    'completed-unverified': { suppressed: 'complementary' as const },
    failed: 0,
    'expired-before-start': 0,
    'expired-after-start': 0,
    approved: 0,
    declined: 0,
    'needs-review': 0,
    'marked-for-review': 0,
    'decided-automatic': 0,
    'decided-manual': 0,
    'decided-not-declared': 0,
  };
  const rates = {
    'success-rate': { value: 20 / 24 },
    'completed-verified-rate': { value: 0.5 },
    'completed-with-fallback-rate': { below: 42 },
    'completed-unverified-rate': { suppressed: true as const },
    'rejected-rate': { below: 42 },
    'needs-review-rate': { below: 42 },
    'expiration-rate': { below: 34 },
  };
  return {
    data: {
      type: 'analytics-inquiries',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf({ suppressedCells: 2, ...options }),
        buckets: [
          {
            ...bucketOf(days[0]),
            counts: { ...counts, created: 25, started: 15 },
            rates,
            'time-to-finish': { lower: 240, upper: 360 },
          },
          { ...bucketOf(days[1]), counts, rates, 'time-to-finish': { suppressed: true } },
          {
            ...bucketOf(days[2], true),
            counts: { created: { suppressed: 'small-count' }, started: 0 },
          },
        ],
        totals: { counts, rates, 'time-to-finish': { lower: 240, upper: 360 } },
      },
    },
  };
}

/** `GET /analytics/funnel`: the first day before the first step record. */
export function funnelAnswer(
  options: AnswerOptions & { stepDataFrom?: string | null } = {},
): AnalyticsFunnelDocument {
  const stepDataFrom = options.stepDataFrom === undefined ? days[1] : options.stepDataFrom;
  return {
    data: {
      type: 'analytics-funnel',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf({ suppressedCells: 1, ...options }),
        buckets: days.map((day) => ({
          ...bucketOf(day, day === days[2]),
          'step-data': stepDataFrom !== null && day >= stepDataFrom,
          counts: { started: day === days[0] ? 0 : 20 },
        })),
        totals: {
          'step-data-from': stepDataFrom,
          versions:
            stepDataFrom === null
              ? []
              : [
                  {
                    'inquiry-template-version-id': ANALYTICS_IDS.version,
                    counts: { started: 40 },
                    steps: [
                      {
                        'step-id': 'consent',
                        counts: { entered: 40, exited: 38, revisits: 0 },
                        rates: { 'overall-share': { value: 1 } },
                      },
                      {
                        'step-id': 'government_id',
                        counts: {
                          entered: 30,
                          exited: 25,
                          revisits: { suppressed: 'small-count' },
                        },
                        rates: {
                          'overall-share': { value: 0.75 },
                          'step-share': { value: 30 / 38 },
                        },
                      },
                    ],
                    transitions: [
                      { 'from-step-id': 'consent', 'to-step-id': 'government_id', count: 38 },
                    ],
                    paths: [
                      { 'step-ids': ['consent', 'government_id'], count: 25 },
                      { 'step-ids': ['consent'], count: { suppressed: 'small-count' } },
                    ],
                  },
                ],
        },
      },
    },
  };
}

/** `GET /analytics/verifications`: one group and one step. */
export function verificationsAnswer(options: AnswerOptions = {}): AnalyticsVerificationsDocument {
  const counts = {
    created: 30,
    submitted: 28,
    passed: 22,
    failed: { suppressed: 'small-count' as const },
    'requires-retry': { suppressed: 'complementary' as const },
    skipped: 0,
    'needs-review': 0,
    canceled: 0,
  };
  return {
    data: {
      type: 'analytics-verifications',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf({ suppressedCells: 2, ...options }),
        buckets: days.slice(0, 2).map((day) => ({ ...bucketOf(day), counts })),
        totals: {
          groups: [
            {
              'verification-type': 'government-id',
              'capture-method': 'camera',
              country: 'US',
              counts,
              rates: { 'pass-rate-per-attempt': { above: 70 } },
            },
            {
              'verification-type': 'selfie',
              'capture-method': null,
              country: null,
              counts: { ...counts, created: 0, submitted: 0, passed: 0, failed: 0 },
              rates: { 'pass-rate-per-attempt': { suppressed: true } },
            },
          ],
          steps: [
            {
              'inquiry-template-version-id': ANALYTICS_IDS.version,
              'step-id': 'government_id',
              'verification-type': 'government-id',
              counts: {
                'step-entered': 30,
                'step-passed': 22,
                'step-failed-after-attempts': { suppressed: 'small-count' },
                'step-needs-review': 0,
                'step-skipped': { suppressed: 'complementary' },
              },
              rates: { 'pass-rate-per-person': { value: 22 / 30 } },
            },
          ],
        },
      },
    },
  };
}

/** `GET /analytics/checks`: one check that ran, one beta check that never ran. */
export function checksAnswer(options: AnswerOptions = {}): AnalyticsChecksDocument {
  return {
    data: {
      type: 'analytics-checks',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf({ suppressedCells: 1, ...options }),
        buckets: days.slice(0, 2).map((day) => ({
          ...bucketOf(day),
          counts: { runs: 30, failed: 0 },
        })),
        totals: {
          checks: [
            {
              'check-name': 'id_barcode_detection',
              'verification-type': 'government-id',
              requirement: 'required',
              tier: 'R',
              stage: 'ga',
              ran: true,
              counts: {
                runs: 60,
                passed: 45,
                failed: 0,
                'not-applicable': 0,
                errored: { suppressed: 'small-count' },
                'not-configured': 0,
                pending: 0,
                'failed-verifications': 0,
              },
              rates: { 'failure-share': { suppressed: true } },
              reasons: [{ reason: 'provider_unavailable', count: { suppressed: 'small-count' } }],
            },
            {
              'check-name': 'id_double_side_detection',
              'verification-type': 'government-id',
              requirement: 'not_required',
              tier: 'H',
              stage: 'beta',
              ran: false,
              counts: {},
              rates: {},
              reasons: [],
            },
          ],
        },
      },
    },
  };
}

/** `GET /analytics/cases`: `assignees` `null` unless the reader holds users:write. */
export function casesAnswer(
  options: AnswerOptions & { assignees?: boolean } = {},
): AnalyticsCasesDocument {
  const counts = { created: 25, resolved: 20, 'sla-met': 15, 'sla-missed': 0 };
  return {
    data: {
      type: 'analytics-cases',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf(options),
        buckets: days.slice(0, 2).map((day) => ({ ...bucketOf(day), counts })),
        totals: {
          counts,
          'resolution-time': {
            median: { lower: 3600, upper: 5400 },
            p90: { suppressed: true },
          },
          assignees:
            options.assignees === true
              ? [
                  {
                    'user-id': ANALYTICS_IDS.reviewer,
                    counts: { assigned: 15, resolved: 12 },
                  },
                  { 'user-id': null, counts: { assigned: { suppressed: 'small-count' } } },
                ]
              : null,
        },
      },
    },
  };
}

/** `GET /analytics/signals`: the bot score's bins and a few not evaluated. */
export function signalsAnswer(options: AnswerOptions = {}): AnalyticsSignalsDocument {
  return {
    data: {
      type: 'analytics-signals',
      id: ANSWER_ID,
      attributes: {
        ...attributesOf(options),
        buckets: days.map((day) => bucketOf(day, day === days[2])),
        totals: {
          signals: [
            {
              name: 'inquiry/bot_score',
              tier: 'H',
              stage: 'beta',
              bins: [
                { bin: '0-9', count: 30 },
                { bin: '10-19', count: { suppressed: 'small-count' } },
                { bin: '90-100', count: 0 },
              ],
              'not-evaluated': { suppressed: 'small-count' },
            },
          ],
        },
      },
    },
  };
}

/** `GET /analytics/<report>` answers `body`. */
export function serveAnalytics(api: RouteApi, report: AnalyticsReport, body: unknown): RouteApi {
  return api.on('GET', `${ANALYTICS_PATH}/${report}`, 200, body);
}

export interface ExportOptions {
  readonly id?: string;
  readonly objectType?: ExportObjectType;
  readonly status?: ExportResource['attributes']['status'];
  readonly personalData?: boolean;
  readonly errorCode?: string;
  readonly rowCount?: number;
  readonly savedViewId?: string | null;
  readonly filterKeys?: readonly string[];
}

/** An export: completed by default, with its count, times and size. */
export function exportResource(options: ExportOptions = {}): ExportResource {
  const status = options.status ?? 'completed';
  const finished = status === 'completed' || status === 'expired';
  return {
    type: 'export',
    id: options.id ?? ANALYTICS_IDS.export,
    attributes: {
      'object-type': options.objectType ?? 'inquiries',
      format: 'csv',
      status,
      'filter-keys': [...(options.filterKeys ?? ['filter[status]'])],
      'saved-view-id': options.savedViewId ?? null,
      'include-personal-data': options.personalData ?? false,
      'row-count': finished ? (options.rowCount ?? 120) : null,
      'byte-size': status === 'completed' ? 4096 : null,
      'error-code': status === 'failed' ? (options.errorCode ?? 'export_too_large') : null,
      'created-at': '2026-10-03T10:00:00.000Z',
      'cut-at': finished ? '2026-10-03T10:00:05.000Z' : null,
      'completed-at': finished ? '2026-10-03T10:00:09.000Z' : null,
      'expires-at': finished ? '2026-10-04T10:00:09.000Z' : null,
    },
  };
}

export function serveExports(
  api: RouteApi,
  exports: readonly ExportResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', EXPORTS_PATH, 200, { data: exports, links: { next } });
}

export interface SavedViewOptions {
  readonly id?: string;
  readonly list?: SavedViewList;
  readonly name?: string;
  readonly filters?: Readonly<Record<string, string>>;
  readonly shared?: boolean;
  readonly ownerId?: string;
  readonly invalidFilters?: readonly string[];
}

/** A view of the inquiries list, the caller's own, filtering by status. */
export function savedView(options: SavedViewOptions = {}): SavedViewResource {
  const invalid = [...(options.invalidFilters ?? [])];
  return {
    type: 'saved-view',
    id: options.id ?? ANALYTICS_IDS.view,
    attributes: {
      list: options.list ?? 'inquiries',
      name: options.name ?? 'Failed this month',
      filters: { ...(options.filters ?? { 'filter[status]': 'failed' }) },
      columns: [],
      sort: null,
      shared: options.shared ?? false,
      'owner-id': options.ownerId ?? ANALYTICS_IDS.owner,
      'filters-valid': invalid.length === 0,
      'invalid-filters': invalid,
      'created-at': '2026-10-01T09:00:00.000Z',
      'updated-at': '2026-10-01T09:00:00.000Z',
    },
  };
}

export function serveSavedViews(api: RouteApi, views: readonly SavedViewResource[]): RouteApi {
  return api.on('GET', SAVED_VIEWS_PATH, 200, { data: views, links: { next: null } });
}

export interface BulkJobOptions {
  readonly status?: ReportBulkJobResource['attributes']['status'];
  readonly rows?: ReportBulkJobResource['attributes']['rows'];
  readonly errorCode?: string | null;
}

/** A finished job: row 1 created, row 2 failed with its code. */
export function reportBulkJob(options: BulkJobOptions = {}): ReportBulkJobResource {
  const status = options.status ?? 'completed';
  const rows = options.rows ?? [
    { row: 1, outcome: 'created' as const, 'report-id': ANALYTICS_IDS.report, 'error-code': null },
    { row: 2, outcome: 'failed' as const, 'report-id': null, 'error-code': 'report_query_invalid' },
  ];
  return {
    type: 'report-bulk-job',
    id: ANALYTICS_IDS.bulkJob,
    attributes: {
      status,
      'report-template-id': ANALYTICS_IDS.reportTemplate,
      'row-count': status === 'pending' ? null : rows.length,
      'created-count': rows.filter((row) => row.outcome === 'created').length,
      'failed-count': rows.filter((row) => row.outcome === 'failed').length,
      rows,
      'error-code': options.errorCode ?? null,
      'created-at': '2026-10-03T10:00:00.000Z',
      'completed-at':
        status === 'completed' || status === 'failed' ? '2026-10-03T10:01:00.000Z' : null,
    },
  };
}

export function serveReportBulkJob(api: RouteApi, job: ReportBulkJobResource): RouteApi {
  return api.on('GET', `${REPORTS_BULK_PATH}/${job.id}`, 200, { data: job });
}
