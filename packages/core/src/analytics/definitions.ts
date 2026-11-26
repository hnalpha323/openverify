/**
 * C163, C164 (Phase 9, Workflow 9B Stage 1a, `contracts-9b`): the analytics vocabulary and the
 * metric definitions as documented constants. They are ours: the public product does not say how it
 * measures (behaviour note 3.5). `docs/analytics/README.md` and the console's help repeat each
 * `definition` word for word, and every answer of `GET /api/v1/analytics/*` names its metrics by
 * these keys. Frozen here; `analytics-logic` computes them (`metrics.ts`) and `integration-9b` alone
 * changes this file.
 *
 * Honesty (rule 10): every rate names its numerator and denominator, every figure is of inquiries
 * (never sessions), of attempts or of people-and-steps as its `unit` says, and an outage is never
 * "not applicable" (a check's `errored` and `not_configured` are their own statuses).
 */
import { FLOW_RECORD_DEVICE_KINDS, FLOW_RECORD_PLATFORMS } from '../flow-records.js';

/** C164.8: the six answers of the read-only aggregates API. */
export const ANALYTICS_REPORTS = Object.freeze([
  'inquiries',
  'funnel',
  'verifications',
  'checks',
  'cases',
  'signals',
] as const);
export type AnalyticsReport = (typeof ANALYTICS_REPORTS)[number];

/** C164.8: the time buckets an answer may ask for. A week starts on Monday (ISO 8601). */
export const ANALYTICS_BUCKETS = Object.freeze(['day', 'week', 'month'] as const);
export type AnalyticsBucket = (typeof ANALYTICS_BUCKETS)[number];

/** C164.8: the longest window, in local days, both ends included (ours, provisional). */
export const ANALYTICS_MAX_RANGE_DAYS = 400;

/**
 * C163.4 (review H04): where a rollup row's counts come from. `facts` rows are recomputed from
 * unredacted inquiries; `redacted` rows hold the contribution of inquiries redacted while their day
 * was open, frozen at redaction. Readers add both.
 */
export const ANALYTICS_ROLLUP_SOURCES = Object.freeze(['facts', 'redacted'] as const);
export type AnalyticsRollupSource = (typeof ANALYTICS_ROLLUP_SOURCES)[number];

/** C163.3: an inquiry's platform and device kind, from the session that served its first step. */
export const ANALYTICS_PLATFORMS = FLOW_RECORD_PLATFORMS;
export const ANALYTICS_DEVICE_KINDS = FLOW_RECORD_DEVICE_KINDS;

/**
 * C163.3, C164.4 (review H03): a check's status in the rollup. `errored` is a `not_applicable`
 * result with a reason in `CHECK_ERROR_REASONS` or ending `_unavailable`, and `not_configured` one
 * with `provider_not_configured`, so an outage never counts as "not applicable"; `pending` is a check
 * that has not finished (C164.4 shows it as its own column).
 */
export const ANALYTICS_CHECK_STATUSES = Object.freeze([
  'passed',
  'failed',
  'not_applicable',
  'errored',
  'not_configured',
  'pending',
] as const);
export type AnalyticsCheckStatus = (typeof ANALYTICS_CHECK_STATUSES)[number];

/** What one counted thing is (C164.1: inquiries, never sessions). */
export type AnalyticsUnit =
  | 'inquiries'
  | 'verifications'
  | 'attempts'
  | 'people-and-steps'
  | 'checks'
  | 'transitions'
  | 'paths'
  | 'cases'
  | 'signal-values';

/** One metric: a count, a rate over two counts, or a bucketed duration. */
export interface AnalyticsMetric {
  readonly key: string;
  readonly report: AnalyticsReport;
  readonly kind: 'count' | 'rate' | 'duration';
  readonly unit: AnalyticsUnit;
  /** The words the docs and the console show, the same everywhere (C164.1). */
  readonly definition: string;
  /** A rate's numerator and denominator, each a count of the same report. */
  readonly numerator?: readonly string[];
  readonly denominator?: readonly string[];
  /**
   * C163.4 (reviews H28, P21): served for the current day and for every open day's 5-minute
   * refresh. Every other count is an outcome, refreshed once a local day and never served live.
   */
  readonly live?: true;
}

const count = (
  report: AnalyticsReport,
  key: string,
  unit: AnalyticsUnit,
  definition: string,
  live?: true,
): AnalyticsMetric =>
  Object.freeze({ key, report, kind: 'count', unit, definition, ...(live ? { live } : {}) });

const rate = (
  report: AnalyticsReport,
  key: string,
  unit: AnalyticsUnit,
  numerator: readonly string[],
  denominator: readonly string[],
  definition: string,
): AnalyticsMetric =>
  Object.freeze({
    key,
    report,
    kind: 'rate',
    unit,
    definition,
    numerator: Object.freeze([...numerator]),
    denominator: Object.freeze([...denominator]),
  });

const duration = (report: AnalyticsReport, key: string, definition: string): AnalyticsMetric =>
  Object.freeze({
    key,
    report,
    kind: 'duration',
    unit: report === 'cases' ? 'cases' : 'inquiries',
    definition,
  });

/**
 * C164.1-C164.6: every metric of every answer, in the order the answers list them. An inquiry counts
 * on its creation day in the reporting time zone (a cohort), its verifications and checks on the
 * same day, and a case on its own creation day (review H05).
 */
export const ANALYTICS_METRICS: readonly AnalyticsMetric[] = Object.freeze([
  // C164.1: inquiries.
  count('inquiries', 'created', 'inquiries', 'Inquiries created.', true),
  count(
    'inquiries',
    'started',
    'inquiries',
    'Inquiries whose first step the server served (pending).',
    true,
  ),
  count('inquiries', 'interacted', 'inquiries', 'Started inquiries whose first step was exited.'),
  count(
    'inquiries',
    'finished',
    'inquiries',
    'Inquiries whose flow reached completed or failed; an expired inquiry is not finished.',
  ),
  count('inquiries', 'completed', 'inquiries', 'Finished inquiries now completed.'),
  count(
    'inquiries',
    'completed-verified',
    'inquiries',
    'Completed inquiries whose every verification on the path passed.',
  ),
  count(
    'inquiries',
    'completed-with-fallback',
    'inquiries',
    'Completed inquiries whose path took an exhausted fallback.',
  ),
  count(
    'inquiries',
    'completed-unverified',
    'inquiries',
    'Completed inquiries whose path held no verification.',
  ),
  count('inquiries', 'failed', 'inquiries', 'Finished inquiries now failed.'),
  count(
    'inquiries',
    'expired-before-start',
    'inquiries',
    'Inquiries that expired before their first step was served.',
  ),
  count(
    'inquiries',
    'expired-after-start',
    'inquiries',
    'Started inquiries that expired before finishing.',
  ),
  count('inquiries', 'approved', 'inquiries', 'Finished inquiries now approved.'),
  count('inquiries', 'declined', 'inquiries', 'Finished inquiries now declined.'),
  count('inquiries', 'needs-review', 'inquiries', 'Finished inquiries now in needs review.'),
  count(
    'inquiries',
    'marked-for-review',
    'inquiries',
    'Finished inquiries that a flow or a check sent to review at least once.',
  ),
  count(
    'inquiries',
    'decided-automatic',
    'inquiries',
    'Decided inquiries whose decision record says solely automated.',
  ),
  count('inquiries', 'decided-manual', 'inquiries', 'Decided inquiries decided by a person.'),
  count(
    'inquiries',
    'decided-not-declared',
    'inquiries',
    'Decided inquiries whose decision did not declare whether it was automated (an API decision without solely-automated).',
  ),
  rate(
    'inquiries',
    'success-rate',
    'inquiries',
    ['completed', 'approved'],
    ['finished'],
    'Finished inquiries now completed or approved, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'completed-verified-rate',
    'inquiries',
    ['completed-verified'],
    ['finished'],
    'Completed with every verification on the path passed, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'completed-with-fallback-rate',
    'inquiries',
    ['completed-with-fallback'],
    ['finished'],
    'Completed through a fallback, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'completed-unverified-rate',
    'inquiries',
    ['completed-unverified'],
    ['finished'],
    'Completed with no verification, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'rejected-rate',
    'inquiries',
    ['failed', 'declined'],
    ['finished'],
    'Finished inquiries now failed or declined, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'needs-review-rate',
    'inquiries',
    ['needs-review'],
    ['finished'],
    'Finished inquiries now in needs review, over finished inquiries.',
  ),
  rate(
    'inquiries',
    'expiration-rate',
    'inquiries',
    ['expired-after-start'],
    ['started'],
    'Started inquiries that expired, over started inquiries; inquiries that expired before starting are their own count, so the rate never passes 100%.',
  ),
  duration(
    'inquiries',
    'time-to-finish',
    'From creation to the flow reaching completed or failed, as the bucket that holds the median (approximate).',
  ),
  // C164.2: the funnel, from the server's step record, never from client-reported screen views.
  count(
    'funnel',
    'started',
    'inquiries',
    "Inquiries of the version that started (the overall share's denominator).",
  ),
  count('funnel', 'entered', 'inquiries', 'Inquiries that entered the step (their first entry).'),
  count('funnel', 'exited', 'inquiries', 'Inquiries that left the step.'),
  count('funnel', 'revisits', 'inquiries', 'Inquiries that entered the step more than once.'),
  count(
    'funnel',
    'transitions',
    'transitions',
    'Moves from one person-visible step to the next; branch and action steps are edges, not steps.',
  ),
  count(
    'funnel',
    'paths',
    'paths',
    'Inquiries that took the same sequence of person-visible steps (the 20 most frequent).',
  ),
  rate(
    'funnel',
    'overall-share',
    'inquiries',
    ['entered'],
    ['started'],
    'Inquiries that entered the step, over started inquiries.',
  ),
  rate(
    'funnel',
    'step-share',
    'inquiries',
    ['entered'],
    ['transitions'],
    'Inquiries that entered the step, over the sum of the transitions into it (a step can have several predecessors).',
  ),
  // C164.3: verifications, each attempt its own verification row.
  count('verifications', 'created', 'attempts', 'Verification attempts created.'),
  count('verifications', 'submitted', 'attempts', 'Attempts submitted.'),
  count('verifications', 'passed', 'attempts', 'Attempts that passed.'),
  count('verifications', 'failed', 'attempts', 'Attempts that failed.'),
  count('verifications', 'requires-retry', 'attempts', 'Attempts that asked the person to retry.'),
  count('verifications', 'skipped', 'attempts', 'Attempts that were skipped.'),
  count('verifications', 'needs-review', 'attempts', 'Attempts sent to review.'),
  count('verifications', 'canceled', 'attempts', 'Attempts canceled.'),
  rate(
    'verifications',
    'pass-rate-per-attempt',
    'attempts',
    ['passed'],
    ['passed', 'failed', 'requires-retry'],
    'Attempts that passed, over attempts that passed, failed or asked for a retry.',
  ),
  count(
    'verifications',
    'step-entered',
    'people-and-steps',
    'Inquiries that entered the verification step.',
  ),
  count(
    'verifications',
    'step-passed',
    'people-and-steps',
    'Inquiries whose last attempt at the step passed.',
  ),
  count(
    'verifications',
    'step-failed-after-attempts',
    'people-and-steps',
    'Inquiries whose step ended without passing, its attempts used up or not retriable.',
  ),
  count(
    'verifications',
    'step-needs-review',
    'people-and-steps',
    'Inquiries whose last attempt at the step went to review.',
  ),
  count('verifications', 'step-skipped', 'people-and-steps', 'Inquiries whose step was skipped.'),
  rate(
    'verifications',
    'pass-rate-per-person',
    'people-and-steps',
    ['step-passed'],
    ['step-entered'],
    'Inquiries whose last attempt at the step passed, over inquiries that entered the step.',
  ),
  // C164.4: checks; a check that never ran in the window is "not run", never zero failures.
  count('checks', 'runs', 'checks', 'Results written for the check, every status included.'),
  count('checks', 'passed', 'checks', 'Results that passed.'),
  count('checks', 'failed', 'checks', 'Results that failed.'),
  count(
    'checks',
    'not-applicable',
    'checks',
    'Results not applicable for a reason about the input (never an outage).',
  ),
  count(
    'checks',
    'errored',
    'checks',
    'Results that could not be computed: an execution error, a missing input or an unavailable service.',
  ),
  count(
    'checks',
    'not-configured',
    'checks',
    'Results not computed because no provider is configured.',
  ),
  count('checks', 'pending', 'checks', 'Results not finished yet.'),
  count(
    'checks',
    'failed-verifications',
    'verifications',
    "Failed verifications of the check's verification type.",
  ),
  rate(
    'checks',
    'failure-share',
    'verifications',
    ['failed'],
    ['failed-verifications'],
    'Failed results of the check, over the failed verifications of its type.',
  ),
  // C164.5: cases (no availability metric, decision 58).
  count('cases', 'created', 'cases', 'Cases created.', true),
  count('cases', 'resolved', 'cases', 'Cases resolved.'),
  count('cases', 'sla-met', 'cases', 'Resolved cases resolved within their SLA.'),
  count('cases', 'sla-missed', 'cases', 'Cases whose SLA was breached.'),
  duration(
    'cases',
    'resolution-time',
    'From creation to resolution, as the buckets that hold the median and the 90th percentile (approximate).',
  ),
  count(
    'cases',
    'assigned',
    'cases',
    'Cases assigned to the reviewer (shown only to holders of users:write, never exported by name).',
  ),
  // C164.6: signals, in the registry's fixed bins.
  count(
    'signals',
    'values',
    'signal-values',
    'Inquiries whose signal value fell in the bin; a null value counts as "not evaluated".',
  ),
]);

/** The metrics of one answer, in order. */
export function analyticsMetricsOf(report: AnalyticsReport): readonly AnalyticsMetric[] {
  return ANALYTICS_METRICS.filter((metric) => metric.report === report);
}
