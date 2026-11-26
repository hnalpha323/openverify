/**
 * C164.1-C164.6 (Phase 9, Workflow 9B; `analytics-logic` builds it in Stage 2): the metric
 * definitions of `definitions.ts` as pure functions over rollup rows, before suppression. Each
 * answer's figures are keyed by the metric keys of `ANALYTICS_METRICS`; a rate is its numerator and
 * denominator, never a division, so `suppression.ts` decides what may be shown. The rows of both
 * sources (`facts`, `redacted`) are added (C163.4). Signatures frozen by `contracts-9b`.
 *
 * As built (`analytics-logic`, ours): every function refuses rows of more than one environment
 * (sandbox and production never mix, A13), a count that is not a whole number of at least 0, a
 * histogram that does not have `DURATION_BUCKET_COUNT` entries and a rate whose numerator passes its
 * denominator, each with an `AnalyticsInputError` that names the input and never its value. Two rates
 * are left out rather than shown outside their definition: a funnel step's `step-share` when no
 * transition leads into the step or when its entries pass them (the entry step, entered from the
 * start, which `analytics_transition_daily` does not record; its overall share is its figure), and a
 * check's `failure-share` when its failed results pass the failed verifications of its type (an
 * advisory check fails without failing the verification) or there are none.
 */
import {
  analyticsMetricsOf,
  type AnalyticsCheckStatus,
  type AnalyticsReport,
} from './definitions.js';
import { DURATION_BUCKET_COUNT } from './durations.js';
import { AnalyticsInputError, assertCount } from './errors.js';
import { ANALYTICS_FLOW_START_STEP_ID } from './rows.js';
import type {
  AnalyticsCaseAssigneeDailyRow,
  AnalyticsCaseDailyRow,
  AnalyticsCheckDailyRow,
  AnalyticsCheckReasonDailyRow,
  AnalyticsInquiryDailyRow,
  AnalyticsPathDailyRow,
  AnalyticsRowKey,
  AnalyticsSignalDailyRow,
  AnalyticsStepDailyRow,
  AnalyticsTransitionDailyRow,
  AnalyticsVerificationDailyRow,
  AnalyticsVerificationStepDailyRow,
} from './rows.js';
import { SIGNAL_BINS, SIGNAL_NOT_EVALUATED_BIN } from './signal-bins.js';
import type { AnalyticsAdditiveGroup } from './suppression.js';

export * from './errors.js';

/** A rate as its two counts. */
export interface AnalyticsRateFigure {
  readonly numerator: number;
  readonly denominator: number;
}

/** One group's figures: counts and rates by metric key, and the duration histograms. */
export interface AnalyticsFigures {
  readonly counts: Readonly<Record<string, number>>;
  readonly rates: Readonly<Record<string, AnalyticsRateFigure>>;
  /** By duration metric key, `DURATION_BUCKET_COUNT` entries each. */
  readonly histograms: Readonly<Record<string, readonly number[]>>;
}

/** C164.2: a version's steps, transitions and most frequent paths. */
export interface AnalyticsFunnelFigures {
  readonly steps: readonly {
    readonly inquiryTemplateVersionId: string;
    readonly stepId: string;
    readonly figures: AnalyticsFigures;
  }[];
  /** AL6: the transitions from the start (`ANALYTICS_FLOW_START_STEP_ID`) into each entry step. */
  readonly entries: readonly {
    readonly inquiryTemplateVersionId: string;
    readonly toStepId: string;
    readonly count: number;
  }[];
  /** The moves between two person-visible steps. */
  readonly transitions: readonly {
    readonly inquiryTemplateVersionId: string;
    readonly fromStepId: string;
    readonly toStepId: string;
    readonly count: number;
  }[];
  /** The 20 most frequent, ordered by count, then by `pathSha256`. */
  readonly paths: readonly {
    readonly inquiryTemplateVersionId: string;
    readonly stepIds: readonly string[];
    readonly count: number;
  }[];
}

// Shared --------------------------------------------------------------------------------------

/** Refuses rows of more than one environment (A13). */
function oneEnvironment(...rowSets: readonly (readonly AnalyticsRowKey[])[]): void {
  let environment: string | null = null;
  for (const rows of rowSets) {
    for (const row of rows) {
      environment ??= row.environmentId;
      if (row.environmentId !== environment) {
        throw new AnalyticsInputError('analytics rows are of one environment');
      }
    }
  }
}

/** By metric key, the column of `Row` it sums. */
type Columns<Row> = Readonly<Record<string, keyof Row>>;

function sumColumns<Row>(rows: readonly Row[], columns: Columns<Row>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, column] of Object.entries(columns)) {
    let sum = 0;
    for (const row of rows) {
      sum += assertCount(row[column] as number, `column ${String(column)}`);
    }
    counts[key] = sum;
  }
  return counts;
}

function figureOf(
  counts: Record<string, number>,
  numerator: readonly string[],
  denominator: readonly string[],
) {
  const sum = (keys: readonly string[]) =>
    keys.reduce((total, key) => total + (counts[key] ?? 0), 0);
  return { numerator: sum(numerator), denominator: sum(denominator) };
}

/** Every rate of `report` from `counts`, refusing one whose numerator passes its denominator. */
function ratesOf(
  report: AnalyticsReport,
  counts: Record<string, number>,
): Record<string, AnalyticsRateFigure> {
  const rates: Record<string, AnalyticsRateFigure> = {};
  for (const metric of analyticsMetricsOf(report)) {
    if (metric.kind !== 'rate') {
      continue;
    }
    const figure = figureOf(counts, metric.numerator ?? [], metric.denominator ?? []);
    if (figure.numerator > figure.denominator) {
      throw new AnalyticsInputError(`${metric.key}: the numerator passes the denominator`);
    }
    rates[metric.key] = figure;
  }
  return rates;
}

function addHistograms(histograms: readonly (readonly number[])[], what: string): number[] {
  const total = Array.from({ length: DURATION_BUCKET_COUNT }, () => 0);
  for (const histogram of histograms) {
    if (histogram.length !== DURATION_BUCKET_COUNT) {
      throw new AnalyticsInputError(`${what} has ${String(DURATION_BUCKET_COUNT)} buckets`);
    }
    histogram.forEach((count, index) => {
      total[index] = (total[index] ?? 0) + assertCount(count, what);
    });
  }
  return total;
}

const EMPTY: AnalyticsFigures = Object.freeze({
  counts: Object.freeze({}),
  rates: Object.freeze({}),
  histograms: Object.freeze({}),
});

const byKey = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

// C164.1: inquiries ------------------------------------------------------------------------------

const INQUIRY_COLUMNS: Columns<AnalyticsInquiryDailyRow> = {
  created: 'created',
  started: 'started',
  interacted: 'interacted',
  finished: 'finished',
  completed: 'completed',
  'completed-verified': 'completedVerified',
  'completed-with-fallback': 'completedWithFallback',
  'completed-unverified': 'completedUnverified',
  failed: 'failed',
  'expired-before-start': 'expiredBeforeStart',
  'expired-after-start': 'expiredAfterStart',
  approved: 'approved',
  declined: 'declined',
  'needs-review': 'needsReview',
  'marked-for-review': 'markedForReview',
  'decided-automatic': 'decidedAutomatic',
  'decided-manual': 'decidedManual',
  'decided-not-declared': 'decidedNotDeclared',
};

/**
 * C164.1: the inquiry counts, the rates (success, its three splits, rejected, needs review,
 * expiration) and the time-to-finish histogram.
 */
export function inquiryFigures(rows: readonly AnalyticsInquiryDailyRow[]): AnalyticsFigures {
  oneEnvironment(rows);
  const counts = sumColumns(rows, INQUIRY_COLUMNS);
  return {
    counts,
    rates: ratesOf('inquiries', counts),
    histograms: {
      'time-to-finish': addHistograms(
        rows.map((row) => row.finishSecondsHistogram),
        'finish-seconds-histogram',
      ),
    },
  };
}

// C164.2: the funnel ----------------------------------------------------------------------------

/**
 * C164.2: the funnel of one version, `started` being the window's started inquiries of that version
 * (the overall share's denominator). Steps are ordered by id, transitions by their two ids, and the
 * 20 most frequent paths by count (most first), then by `pathSha256`.
 */
export function funnelFigures(
  rows: {
    readonly steps: readonly AnalyticsStepDailyRow[];
    readonly transitions: readonly AnalyticsTransitionDailyRow[];
    readonly paths: readonly AnalyticsPathDailyRow[];
  },
  started: number,
): AnalyticsFunnelFigures {
  oneEnvironment(rows.steps, rows.transitions, rows.paths);
  assertCount(started, 'started');
  const versions = new Set(
    [...rows.steps, ...rows.transitions, ...rows.paths].map((row) => row.inquiryTemplateVersionId),
  );
  if (versions.size > 1) {
    throw new AnalyticsInputError('a funnel is of one template version');
  }
  const version = [...versions][0] ?? '';

  const transitions = new Map<string, { fromStepId: string; toStepId: string; count: number }>();
  const entries = new Map<string, number>();
  const into = new Map<string, number>();
  for (const row of rows.transitions) {
    if (row.fromStepId === ANALYTICS_FLOW_START_STEP_ID) {
      // AL6: the entry step's transitions from the start count into it, never as a move.
      entries.set(
        row.toStepId,
        (entries.get(row.toStepId) ?? 0) + assertCount(row.count, 'transition count'),
      );
      into.set(row.toStepId, (into.get(row.toStepId) ?? 0) + row.count);
      continue;
    }
    const key = `${row.fromStepId}\u0000${row.toStepId}`;
    const entry = transitions.get(key) ?? {
      fromStepId: row.fromStepId,
      toStepId: row.toStepId,
      count: 0,
    };
    entry.count += assertCount(row.count, 'transition count');
    transitions.set(key, entry);
    into.set(row.toStepId, (into.get(row.toStepId) ?? 0) + row.count);
  }

  const steps = new Map<string, AnalyticsStepDailyRow[]>();
  for (const row of rows.steps) {
    steps.set(row.stepId, [...(steps.get(row.stepId) ?? []), row]);
  }
  const stepFigures = [...steps.keys()].sort(byKey).map((stepId) => {
    const counts = sumColumns(steps.get(stepId) ?? [], {
      entered: 'entered',
      exited: 'exited',
      revisits: 'revisits',
    });
    const entered = counts.entered ?? 0;
    if (entered > started) {
      throw new AnalyticsInputError('overall-share: the numerator passes the denominator');
    }
    const rates: Record<string, AnalyticsRateFigure> = {
      'overall-share': { numerator: entered, denominator: started },
    };
    const transitionsInto = into.get(stepId) ?? 0;
    if (transitionsInto > 0 && entered <= transitionsInto) {
      rates['step-share'] = { numerator: entered, denominator: transitionsInto };
    }
    return {
      inquiryTemplateVersionId: version,
      stepId,
      figures: { counts, rates, histograms: {} },
    };
  });

  const paths = new Map<string, { stepIds: readonly string[]; count: number }>();
  for (const row of rows.paths) {
    const entry = paths.get(row.pathSha256);
    if (entry !== undefined && entry.stepIds.join('\u0000') !== row.stepIds.join('\u0000')) {
      throw new AnalyticsInputError('a path hash names one sequence of steps');
    }
    paths.set(row.pathSha256, {
      stepIds: row.stepIds,
      count: (entry?.count ?? 0) + assertCount(row.count, 'path count'),
    });
  }

  return {
    steps: stepFigures,
    entries: [...entries]
      .sort(([left], [right]) => byKey(left, right))
      .map(([toStepId, count]) => ({ inquiryTemplateVersionId: version, toStepId, count })),
    transitions: [...transitions.values()]
      .sort(
        (left, right) =>
          byKey(left.fromStepId, right.fromStepId) || byKey(left.toStepId, right.toStepId),
      )
      .map((entry) => ({ inquiryTemplateVersionId: version, ...entry })),
    paths: [...paths]
      .sort(
        ([leftSha, left], [rightSha, right]) =>
          right.count - left.count || byKey(leftSha, rightSha),
      )
      .slice(0, FUNNEL_TOP_PATHS)
      .map(([, path]) => ({
        inquiryTemplateVersionId: version,
        stepIds: path.stepIds,
        count: path.count,
      })),
  };
}

/** C164.2: the per-path view lists the 20 most frequent sequences (the plan's number). */
export const FUNNEL_TOP_PATHS = 20;

// C164.3: verifications -------------------------------------------------------------------------

const ATTEMPT_COLUMNS: Columns<AnalyticsVerificationDailyRow> = {
  created: 'created',
  submitted: 'submitted',
  passed: 'passed',
  failed: 'failed',
  'requires-retry': 'requiresRetry',
  skipped: 'skipped',
  'needs-review': 'needsReview',
  canceled: 'canceled',
};

const STEP_COLUMNS: Columns<AnalyticsVerificationStepDailyRow> = {
  'step-entered': 'entered',
  'step-passed': 'passed',
  'step-failed-after-attempts': 'failedAfterAttempts',
  'step-needs-review': 'needsReview',
  'step-skipped': 'skipped',
};

/**
 * C164.3: the attempt counts with the per-attempt pass rate, and the per-person-and-step outcomes
 * with theirs, over the rows given (the caller passes one group: a type, capture method and country,
 * or a step).
 */
export function verificationFigures(
  attempts: readonly AnalyticsVerificationDailyRow[],
  steps: readonly AnalyticsVerificationStepDailyRow[],
): AnalyticsFigures {
  oneEnvironment(attempts, steps);
  const counts = { ...sumColumns(attempts, ATTEMPT_COLUMNS), ...sumColumns(steps, STEP_COLUMNS) };
  return { counts, rates: ratesOf('verifications', counts), histograms: {} };
}

// C164.4: checks --------------------------------------------------------------------------------

const CHECK_STATUS_KEYS: Readonly<Record<AnalyticsCheckStatus, string>> = {
  passed: 'passed',
  failed: 'failed',
  not_applicable: 'not-applicable',
  errored: 'errored',
  not_configured: 'not-configured',
  pending: 'pending',
};

/** The count key of a check reason: `reason:<code>`. */
export const checkReasonKey = (reason: string): string => `reason:${reason}`;

/**
 * C164.4: a check's results by status, its reasons (`checkReasonKey`) and its share of the failed
 * verifications of its type (`failedVerifications`). A check with no result in the window is "not
 * run": no count at all, never zero failures. The results are of one check, verification type and
 * requirement; the reasons of that check.
 */
export function checkFigures(
  results: readonly AnalyticsCheckDailyRow[],
  reasons: readonly AnalyticsCheckReasonDailyRow[],
  failedVerifications: number,
): AnalyticsFigures {
  oneEnvironment(results, reasons);
  assertCount(failedVerifications, 'failed verifications');
  const [first] = results;
  for (const row of results) {
    if (
      row.checkName !== first?.checkName ||
      row.verificationType !== first.verificationType ||
      row.requirement !== first.requirement
    ) {
      throw new AnalyticsInputError('check results are of one check, type and requirement');
    }
  }
  if (
    reasons.some(
      (row) =>
        row.checkName !== first?.checkName ||
        row.verificationType !== first.verificationType ||
        row.requirement !== first.requirement,
    )
  ) {
    throw new AnalyticsInputError(
      'check reasons are of the check, type and requirement of its results',
    );
  }
  const counts: Record<string, number> = { runs: 0 };
  for (const key of Object.values(CHECK_STATUS_KEYS)) {
    counts[key] = 0;
  }
  for (const row of results) {
    const key = CHECK_STATUS_KEYS[row.status];
    const value = assertCount(row.count, 'check count');
    counts[key] = (counts[key] ?? 0) + value;
    counts.runs = (counts.runs ?? 0) + value;
  }
  if (counts.runs === 0) {
    return EMPTY;
  }
  counts['failed-verifications'] = failedVerifications;
  const byReason = new Map<string, number>();
  for (const row of reasons) {
    byReason.set(
      row.reason,
      (byReason.get(row.reason) ?? 0) + assertCount(row.count, 'reason count'),
    );
  }
  for (const reason of [...byReason.keys()].sort(byKey)) {
    counts[checkReasonKey(reason)] = byReason.get(reason) ?? 0;
  }
  const failed = counts.failed ?? 0;
  return {
    counts,
    rates:
      failedVerifications > 0 && failed <= failedVerifications
        ? { 'failure-share': { numerator: failed, denominator: failedVerifications } }
        : {},
    histograms: {},
  };
}

// C164.5: cases ---------------------------------------------------------------------------------

const CASE_COLUMNS: Columns<AnalyticsCaseDailyRow> = {
  created: 'created',
  resolved: 'resolved',
  'sla-met': 'slaMet',
  'sla-missed': 'slaMissed',
};

/**
 * C164.5: the case counts and the resolution-time histogram; `assigned` (every assignee row added)
 * only for a reader who holds `users:write` (the caller decides and passes `null` otherwise, review
 * P20).
 */
export function caseFigures(
  cases: readonly AnalyticsCaseDailyRow[],
  assignees: readonly AnalyticsCaseAssigneeDailyRow[] | null,
): AnalyticsFigures {
  oneEnvironment(cases, assignees ?? []);
  const counts = sumColumns(cases, CASE_COLUMNS);
  if (assignees !== null) {
    counts.assigned = sumColumns(assignees, { assigned: 'assigned' }).assigned ?? 0;
  }
  return {
    counts,
    rates: {},
    histograms: {
      'resolution-time': addHistograms(
        cases.map((row) => row.resolutionSecondsHistogram),
        'resolution-seconds-histogram',
      ),
    },
  };
}

/**
 * C164.5 (review P20): each reviewer's assigned and resolved cases, for a reader who holds
 * `users:write` (the caller decides); `userId` is `null` once re-keyed to "former user", every former
 * user counted together. Ordered by user id, the former users last.
 */
export function caseAssigneeFigures(
  assignees: readonly AnalyticsCaseAssigneeDailyRow[],
): readonly { readonly userId: string | null; readonly figures: AnalyticsFigures }[] {
  oneEnvironment(assignees);
  const byUser = new Map<string | null, AnalyticsCaseAssigneeDailyRow[]>();
  for (const row of assignees) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  }
  return [...byUser.keys()]
    .sort((left, right) => (left === null ? 1 : right === null ? -1 : byKey(left, right)))
    .map((userId) => ({
      userId,
      figures: {
        counts: sumColumns(byUser.get(userId) ?? [], {
          assigned: 'assigned',
          resolved: 'resolved',
        }),
        rates: {},
        histograms: {},
      },
    }));
}

// C164.6: signals -------------------------------------------------------------------------------

const COUNTRY_BIN = /^[A-Z]{2}$/;

/**
 * C164.6: one signal's counts by bin: every fixed bin in `SIGNAL_BINS` order (zeros included), or the
 * session country's codes in order, then `not-evaluated` (a null value). No rows answers no counts.
 */
export function signalFigures(rows: readonly AnalyticsSignalDailyRow[]): AnalyticsFigures {
  oneEnvironment(rows);
  const [first] = rows;
  if (first === undefined) {
    return EMPTY;
  }
  if (rows.some((row) => row.signalName !== first.signalName)) {
    throw new AnalyticsInputError('signal rows are of one signal');
  }
  const entry = SIGNAL_BINS[first.signalName];
  if (entry === undefined) {
    throw new AnalyticsInputError('the signal is not in the registry');
  }
  const byBin = new Map<string, number>();
  for (const row of rows) {
    const known =
      row.bin === SIGNAL_NOT_EVALUATED_BIN ||
      (entry.kind === 'fixed' ? entry.bins.includes(row.bin) : COUNTRY_BIN.test(row.bin));
    if (!known) {
      throw new AnalyticsInputError(`${first.signalName}: a row's bin is not one of its bins`);
    }
    byBin.set(row.bin, (byBin.get(row.bin) ?? 0) + assertCount(row.count, 'signal count'));
  }
  const bins =
    entry.kind === 'fixed'
      ? entry.bins
      : [...byBin.keys()].filter((bin) => bin !== SIGNAL_NOT_EVALUATED_BIN).sort(byKey);
  const counts: Record<string, number> = {};
  for (const bin of [...bins, SIGNAL_NOT_EVALUATED_BIN]) {
    counts[bin] = byBin.get(bin) ?? 0;
  }
  return { counts, rates: {}, histograms: {} };
}

/**
 * C164.7 (review P21): the additive relations between each answer's counts (`total = Σ parts`, by
 * metric key), which complementary suppression applies at every node of the time lattice so that no
 * hidden count follows from the others by subtraction. Ours. Each holds by the definitions of
 * `ANALYTICS_METRICS` once every inquiry, attempt and step of the window has settled, which a reader
 * may assume of an old window ("start equals finish plus expiry once settled", C164.1); declaring a
 * relation that a still-open window does not yet meet only hides more, never less. The rollup
 * (`api-analytics`) must count so that each holds once settled; in particular the three splits of
 * `completed` are counted over inquiries now `completed`.
 *
 * Not declared, with the reason: `interacted` and `marked-for-review` (subsets with no counted
 * complement); `decided-*` (their population, every inquiry with a decision record, is no served
 * count: a caller that serves it adds the relation); the funnel's step counts (`exited` and
 * `revisits` are subsets of `entered`, and a step is entered through several transitions);
 * `sla-met` and `sla-missed` (an unresolved case can miss its SLA); a check's reasons (a result may
 * carry several). Relations across rows of an answer (versions, groups, a signal's bins and its
 * population) are the caller's, through `AnalyticsTableInput.groups`.
 */
export const ANALYTICS_RELATIONS: Readonly<
  Record<AnalyticsReport, readonly AnalyticsAdditiveGroup[]>
> = Object.freeze({
  inquiries: Object.freeze([
    // Every inquiry starts or expires before starting.
    { total: 'created', parts: ['started', 'expired-before-start'] },
    // Every started inquiry finishes or expires.
    { total: 'started', parts: ['finished', 'expired-after-start'] },
    // A finished inquiry's status now is one of these five.
    {
      total: 'finished',
      parts: ['completed', 'failed', 'approved', 'declined', 'needs-review'],
    },
    // C151.13: a completed inquiry's flow-outcome puts it in exactly one split (review H09).
    {
      total: 'completed',
      parts: ['completed-verified', 'completed-with-fallback', 'completed-unverified'],
    },
  ]),
  funnel: Object.freeze([]),
  verifications: Object.freeze([
    // An attempt is submitted, canceled or skipped.
    { total: 'created', parts: ['submitted', 'canceled', 'skipped'] },
    // A submitted attempt ends passed, failed, asking for a retry or in review.
    { total: 'submitted', parts: ['passed', 'failed', 'requires-retry', 'needs-review'] },
    // C164.3 (review H06): a step's last attempt ends in exactly one of these four.
    {
      total: 'step-entered',
      parts: ['step-passed', 'step-failed-after-attempts', 'step-needs-review', 'step-skipped'],
    },
  ]),
  checks: Object.freeze([
    // Every result has exactly one status (review H03).
    {
      total: 'runs',
      parts: ['passed', 'failed', 'not-applicable', 'errored', 'not-configured', 'pending'],
    },
  ]),
  cases: Object.freeze([]),
  signals: Object.freeze([]),
});
