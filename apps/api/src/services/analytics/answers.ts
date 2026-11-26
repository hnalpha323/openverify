/**
 * C164.1-C164.8 (Workflow 9B, `api-analytics`): the six answers of `GET /api/v1/analytics/*`, each
 * built only from suppressed cells (C164.7, review H18, P21):
 * - every count goes through one `suppressAnalyticsTable` per answer, built over the window's whole
 *   time lattice (days, weeks, months, total) whatever `bucket` is asked, after every filter, with
 *   `ANALYTICS_RELATIONS` and the relations across the answer's rows (versions, groups, checks,
 *   signal bins and their populations);
 * - an answer that shares a cell with another builds the same table: the funnel's `started` is the
 *   inquiries table's, and the verifications and checks answers share one table (the failed
 *   verifications of a type are both);
 * - rates only through `table.rate`, durations only through `suppressDuration`;
 * - a live day carries `created` and `started` alone (H28, P21), and a week, month or total that
 *   holds one adds its outcomes over the stored days only;
 * - `suppressed-cells` counts the hidden cells among those the answer serves.
 * The figures come from `@openverify/core`'s metric functions over the rows (`inquiryFigures`,
 * `funnelFigures`, `checkFigures`, `caseAssigneeFigures`, `signalFigures`), so each metric is its
 * documented definition.
 */
import { createHash } from 'node:crypto';
import {
  ANALYTICS_RELATIONS,
  CHECK_STAGES,
  DURATION_BUCKET_COUNT,
  SIGNAL_BINS,
  SIGNAL_NOT_EVALUATED_BIN,
  SIGNAL_REGISTRY,
  VERIFICATION_TYPES,
  analyticsBucketNodes,
  analyticsMetricsOf,
  analyticsRelationGroups,
  analyticsSeriesCellId,
  analyticsTimeLattice,
  caseAssigneeFigures,
  checkFigures,
  funnelFigures,
  getCheckDefinition,
  listChecks,
  signalFigures,
  suppressAnalyticsTable,
  suppressDuration,
  type AnalyticsAdditiveGroup,
  type AnalyticsBucket,
  type AnalyticsCaseAssigneeDailyRow,
  type AnalyticsCheckDailyRow,
  type AnalyticsCheckReasonDailyRow,
  type AnalyticsCountCell,
  type AnalyticsPathDailyRow,
  type AnalyticsRateCell,
  type AnalyticsReport,
  type AnalyticsSignalDailyRow,
  type AnalyticsStepDailyRow,
  type AnalyticsTable,
  type AnalyticsTimeLattice,
  type AnalyticsTimeNode,
  type AnalyticsTransitionDailyRow,
  type VerificationType,
} from '@openverify/core';
import type { AnalyticsReadContext, AnalyticsWindow, AnyRow } from './read.js';

type Series = Map<string, Map<string, number>>;

/** A metric key as the rows name it: `completed-verified` is `completedVerified`. */
const fieldOf = (key: string): string =>
  key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const countKeys = (report: AnalyticsReport) =>
  analyticsMetricsOf(report)
    .filter((metric) => metric.kind === 'count')
    .map((metric) => metric.key);

const LIVE_KEYS = new Set(['created', 'started']);

/** The served cells' ids, for `suppressed-cells`. */
class Served {
  readonly ids = new Set<string>();
  constructor(private readonly table: AnalyticsTable) {}
  count(id: string): AnalyticsCountCell {
    this.ids.add(id);
    return this.table.count(id);
  }
  rate(numerator: readonly string[], denominator: readonly string[]): AnalyticsRateCell {
    try {
      return this.table.rate(numerator, denominator);
    } catch {
      // A numerator over its denominator (a window not settled): never a value, never a bound.
      return { suppressed: true };
    }
  }
  suppressed(): number {
    return this.table.suppressedAmong(this.ids);
  }
}

/** The day series of `keys` over `rows` (each key's field summed per day); outcomes skip live days. */
function seriesOf(
  rows: readonly AnyRow[],
  keys: readonly string[],
  liveDays: ReadonlySet<string>,
  prefix = '',
): Series {
  const series: Series = new Map();
  for (const key of keys) {
    const days = new Map<string, number>();
    series.set(`${prefix}${key}`, days);
    for (const row of rows) {
      const day = row.day as string;
      if (liveDays.has(day) && !LIVE_KEYS.has(key)) {
        continue;
      }
      const value = Number(row[fieldOf(key)] ?? 0);
      if (value !== 0) {
        days.set(day, (days.get(day) ?? 0) + value);
      }
    }
  }
  return series;
}

/** A relation's keys with a prefix. */
const prefixed = (
  relations: readonly AnalyticsAdditiveGroup[],
  prefix: string,
): AnalyticsAdditiveGroup[] =>
  relations.map((relation) => ({
    total: `${prefix}${relation.total}`,
    parts: relation.parts.map((part) => `${prefix}${part}`),
  }));

/**
 * `ANALYTICS_RELATIONS` hold once a window has settled; an open window breaks them (a pending
 * inquiry is started, neither finished nor expired). Each relation gets one more part, its
 * `unsettled` remainder (the total less its parts, never served), so every equation the table reads
 * is exact. The remainder counts as known to a reader, which is the cautious side: a reader who
 * assumes a settled window takes it to be 0, and where it is 0 that is right. A relation the rows
 * break the other way (parts over their total) is not declared.
 */
function settledSeries(
  series: Series,
  relations: readonly AnalyticsAdditiveGroup[],
): { series: Series; relations: AnalyticsAdditiveGroup[] } {
  const out: Series = new Map(series);
  const declared: AnalyticsAdditiveGroup[] = [];
  for (const relation of relations) {
    const total = series.get(relation.total);
    const parts = relation.parts.map((part) => series.get(part));
    if (total === undefined || parts.some((part) => part === undefined)) {
      continue;
    }
    const days = new Set([...total.keys(), ...parts.flatMap((part) => [...(part?.keys() ?? [])])]);
    const remainder = new Map<string, number>();
    let holds = true;
    for (const day of days) {
      const left =
        (total.get(day) ?? 0) - parts.reduce((sum, part) => sum + (part?.get(day) ?? 0), 0);
      if (left < 0) {
        holds = false;
      } else if (left > 0) {
        remainder.set(day, left);
      }
    }
    if (holds) {
      const key = `${relation.total}.unsettled`;
      out.set(key, remainder);
      declared.push({ total: relation.total, parts: [...relation.parts, key] });
    }
  }
  return { series: out, relations: declared };
}

/** The same for groups between cells off the time axis (`settledSeries`' reasoning). */
function settledGroups(
  values: Map<string, number>,
  groups: readonly AnalyticsAdditiveGroup[],
): AnalyticsAdditiveGroup[] {
  const declared: AnalyticsAdditiveGroup[] = [];
  for (const group of groups) {
    const total = values.get(group.total);
    const parts = group.parts.map((part) => values.get(part));
    if (total === undefined || parts.some((part) => part === undefined)) {
      declared.push(group);
      continue;
    }
    const left = total - parts.reduce((sum: number, part) => sum + (part ?? 0), 0);
    if (left >= 0) {
      const key = `${group.total}.unsettled`;
      values.set(key, left);
      declared.push({ total: group.total, parts: [...group.parts, key] });
    }
  }
  return declared;
}

/** The zone of a bucket: the setting's, unless every stored row of its days is of one other zone. */
function zoneOf(node: AnalyticsTimeNode, rows: readonly AnyRow[], context: AnalyticsReadContext) {
  const days = new Set(node.days);
  const zones = new Set(
    rows.filter((row) => days.has(row.day as string)).map((row) => row.timeZone as string),
  );
  return zones.size === 0 || zones.has(context.zone) ? context.zone : [...zones].sort()[0];
}

function bucketOf(
  node: AnalyticsTimeNode,
  window: AnalyticsWindow,
  rows: readonly AnyRow[],
  context: AnalyticsReadContext,
) {
  return {
    start: node.start,
    end: node.end,
    'time-zone': zoneOf(node, rows, context) ?? context.zone,
    live: node.kind === 'day' && window.liveDays.has(node.start),
  };
}

/** A histogram over the rows of the node's stored days. */
function histogramOf(
  rows: readonly AnyRow[],
  field: string,
  days: ReadonlySet<string>,
  liveDays: ReadonlySet<string>,
): number[] {
  const histogram = Array.from({ length: DURATION_BUCKET_COUNT }, () => 0);
  for (const row of rows) {
    const day = row.day as string;
    if (!days.has(day) || liveDays.has(day)) {
      continue;
    }
    (row[field] as number[]).forEach((count, index) => {
      histogram[index] = (histogram[index] ?? 0) + count;
    });
  }
  return histogram;
}

/** The attributes every answer carries (B15). */
function common(
  context: AnalyticsReadContext,
  window: AnalyticsWindow,
  bucket: AnalyticsBucket,
  served: Served,
) {
  return {
    'time-zone': context.zone,
    'time-zones': window.zones.slice(0, 16),
    from: window.from,
    to: window.to,
    bucket,
    threshold: context.threshold,
    'suppressed-cells': served.suppressed(),
    'settle-days': context.settleDays,
    freshness: {
      'rolled-up-through': context.state?.rolledUpThrough?.toISOString() ?? null,
      'outcomes-as-of': context.state?.outcomesAsOf?.toISOString() ?? null,
    },
  };
}

/** The answer's id: the SHA-256 of its report and canonical query. */
export function answerId(
  report: AnalyticsReport,
  query: Readonly<Record<string, unknown>>,
): string {
  const canonical = Object.keys(query)
    .filter((key) => query[key] !== undefined)
    .sort()
    .map((key) => [key, query[key]]);
  return createHash('sha256')
    .update(JSON.stringify([report, canonical]))
    .digest('hex');
}

export interface AnswerInput {
  context: AnalyticsReadContext;
  window: AnalyticsWindow;
  bucket: AnalyticsBucket;
  id: string;
  /**
   * The inquiries and funnel answers share one table, with the funnel's cells, when the window is
   * filtered by neither device nor tag (the step rollups have neither dimension).
   */
  withFunnel?: boolean;
}

const lattice = (window: AnalyticsWindow): AnalyticsTimeLattice =>
  analyticsTimeLattice(window.from, window.to);

// Inquiries and the funnel (one table, C164.1, C164.2) ---------------------------------------------

const INQUIRY_KEYS = countKeys('inquiries');
const INQUIRY_RATES = analyticsMetricsOf('inquiries').filter((metric) => metric.kind === 'rate');
const TAG_KEYS = ['created', 'finished', 'completed', 'failed'] as const;

interface FunnelCells {
  versions: {
    version: string;
    started: string;
    figures: ReturnType<typeof funnelFigures>;
    steps: Map<string, { entered: string; exited: string; revisits: string }>;
    /** AL6 (K9-24): the cells of the transitions from the start, by entry step. */
    entries: Map<string, string>;
    transitions: Map<string, string>;
    paths: Map<string, string>;
  }[];
}

/**
 * The inquiry cohort's table: the inquiry series and their relations, and, unless the window is
 * filtered by device or tag (the step rollups have neither), each version's started inquiries, steps,
 * transitions and top paths, with `started` over the window equal to the versions' sum.
 */
function inquiryCohortTable(
  context: AnalyticsReadContext,
  window: AnalyticsWindow,
  withFunnel: boolean,
): { table: AnalyticsTable; funnel: FunnelCells } {
  const inquiryRows = window.rows.inquiry ?? [];
  const series = seriesOf(inquiryRows, INQUIRY_KEYS, window.liveDays);
  const cells = new Map<string, number>();
  const groups: AnalyticsAdditiveGroup[] = [];
  const funnel: FunnelCells = { versions: [] };
  const time = lattice(window);
  if (withFunnel) {
    const started = new Map<string, number>();
    for (const row of inquiryRows) {
      const version = row.inquiryTemplateVersionId as string;
      started.set(version, (started.get(version) ?? 0) + Number(row.started));
    }
    const steps = (window.rows.step ?? []) as unknown as AnalyticsStepDailyRow[];
    const transitions = (window.rows.transition ?? []) as unknown as AnalyticsTransitionDailyRow[];
    const paths = (window.rows.path ?? []) as unknown as AnalyticsPathDailyRow[];
    const versions = new Set<string>([
      ...[...started].filter(([, count]) => count > 0).map(([version]) => version),
      ...steps.map((row) => row.inquiryTemplateVersionId),
    ]);
    for (const [index, version] of [...versions].sort().entries()) {
      const id = (suffix: string) => `funnel.v${String(index)}.${suffix}`;
      const of = <Row extends { inquiryTemplateVersionId: string }>(rows: readonly Row[]) =>
        rows.filter((row) => row.inquiryTemplateVersionId === version);
      const figures = funnelFigures(
        { steps: of(steps), transitions: of(transitions), paths: of(paths) },
        started.get(version) ?? 0,
      );
      cells.set(id('started'), started.get(version) ?? 0);
      const entry: FunnelCells['versions'][number] = {
        version,
        started: id('started'),
        figures,
        steps: new Map(),
        entries: new Map(),
        transitions: new Map(),
        paths: new Map(),
      };
      for (const step of figures.steps) {
        const stepId = (key: string) => id(`s.${step.stepId}.${key}`);
        for (const key of ['entered', 'exited', 'revisits'] as const) {
          cells.set(stepId(key), step.figures.counts[key] ?? 0);
        }
        entry.steps.set(step.stepId, {
          entered: stepId('entered'),
          exited: stepId('exited'),
          revisits: stepId('revisits'),
        });
      }
      for (const start of figures.entries) {
        const cell = id(`e.${start.toStepId}`);
        cells.set(cell, start.count);
        entry.entries.set(start.toStepId, cell);
      }
      for (const transition of figures.transitions) {
        const cell = id(`t.${transition.fromStepId}.${transition.toStepId}`);
        cells.set(cell, transition.count);
        entry.transitions.set(`${transition.fromStepId}>${transition.toStepId}`, cell);
      }
      figures.paths.forEach((path, rank) => {
        const cell = id(`p.${String(rank)}`);
        cells.set(cell, path.count);
        entry.paths.set(String(rank), cell);
      });
      funnel.versions.push(entry);
    }
    if (funnel.versions.length > 0) {
      groups.push({
        total: analyticsSeriesCellId('started', time.total),
        parts: funnel.versions.map((entry) => entry.started),
      });
    }
  }
  const settled = settledSeries(series, ANALYTICS_RELATIONS.inquiries);
  const table = suppressAnalyticsTable({
    threshold: context.threshold,
    lattice: time,
    series: settled.series,
    relations: settled.relations,
    cells,
    groups,
  });
  return { table, funnel };
}

export function inquiriesAnswer(input: AnswerInput, tagged: boolean) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const nodes = analyticsBucketNodes(time, bucket);
  if (tagged) {
    // `filter[tag]`: the tag rollup's four counts, as series without relations (no rate, no
    // duration: the tag rollup holds neither).
    const rows = window.rows.tag ?? [];
    const table = suppressAnalyticsTable({
      threshold: context.threshold,
      lattice: time,
      series: seriesOf(rows, TAG_KEYS, window.liveDays),
    });
    const served = new Served(table);
    const countsAt = (node: AnalyticsTimeNode, live: boolean) =>
      Object.fromEntries(
        TAG_KEYS.filter((key) => !live || LIVE_KEYS.has(key)).map((key) => [
          key,
          served.count(analyticsSeriesCellId(key, node)),
        ]),
      );
    const buckets = nodes.map((node) => {
      const shape = bucketOf(node, window, rows, context);
      return { ...shape, counts: countsAt(node, shape.live) };
    });
    const totals = { counts: countsAt(time.total, false), rates: {}, 'time-to-finish': null };
    return {
      data: {
        type: 'analytics-inquiries' as const,
        id,
        attributes: { ...common(context, window, bucket, served), buckets, totals },
      },
    };
  }
  const rows = window.rows.inquiry ?? [];
  const { table } = inquiryCohortTable(context, window, input.withFunnel ?? false);
  const served = new Served(table);
  const countsAt = (node: AnalyticsTimeNode, live: boolean) =>
    Object.fromEntries(
      INQUIRY_KEYS.filter((key) => !live || LIVE_KEYS.has(key)).map((key) => [
        key,
        served.count(analyticsSeriesCellId(key, node)),
      ]),
    );
  const ratesAt = (node: AnalyticsTimeNode) =>
    Object.fromEntries(
      INQUIRY_RATES.map((metric) => [
        metric.key,
        served.rate(
          (metric.numerator ?? []).map((key) => analyticsSeriesCellId(key, node)),
          (metric.denominator ?? []).map((key) => analyticsSeriesCellId(key, node)),
        ),
      ]),
    );
  const finishAt = (node: AnalyticsTimeNode) =>
    suppressDuration(
      histogramOf(rows, 'finishSecondsHistogram', new Set(node.days), window.liveDays),
      50,
      context.threshold,
    );
  const buckets = nodes.map((node) => {
    const shape = bucketOf(node, window, rows, context);
    return shape.live
      ? { ...shape, counts: countsAt(node, true) }
      : {
          ...shape,
          counts: countsAt(node, false),
          rates: ratesAt(node),
          'time-to-finish': finishAt(node),
        };
  });
  const totals = {
    counts: countsAt(time.total, false),
    rates: ratesAt(time.total),
    'time-to-finish': finishAt(time.total),
  };
  return {
    data: {
      type: 'analytics-inquiries' as const,
      id,
      attributes: { ...common(context, window, bucket, served), buckets, totals },
    },
  };
}

/** C164.2: the funnel per version, its buckets' `started` from the inquiry cohort's table. */
export function funnelAnswer(input: AnswerInput) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const rows = window.rows.inquiry ?? [];
  const { table, funnel } = inquiryCohortTable(context, window, true);
  const served = new Served(table);
  const buckets = analyticsBucketNodes(time, bucket).map((node) => ({
    ...bucketOf(node, window, rows, context),
    // "No step data" before the environment's first step record (C163.1), never 0.
    'step-data': context.stepDataFrom !== null && node.end >= context.stepDataFrom,
    counts: { started: served.count(analyticsSeriesCellId('started', node)) },
  }));
  const versions = funnel.versions.map((entry) => ({
    'inquiry-template-version-id': entry.version,
    counts: { started: served.count(entry.started) },
    steps: entry.figures.steps.map((step) => {
      const cells = entry.steps.get(step.stepId);
      const into = [
        entry.entries.get(step.stepId),
        ...entry.figures.transitions
          .filter((transition) => transition.toStepId === step.stepId)
          .map((transition) =>
            entry.transitions.get(`${transition.fromStepId}>${transition.toStepId}`),
          ),
      ].filter((cell): cell is string => cell !== undefined);
      const entered = cells?.entered ?? '';
      return {
        'step-id': step.stepId,
        counts: {
          entered: served.count(entered),
          exited: served.count(cells?.exited ?? ''),
          revisits: served.count(cells?.revisits ?? ''),
        },
        rates: {
          'overall-share': served.rate([entered], [entry.started]),
          ...('step-share' in step.figures.rates
            ? { 'step-share': served.rate([entered], into) }
            : {}),
        },
      };
    }),
    transitions: entry.figures.transitions.map((transition) => ({
      'from-step-id': transition.fromStepId,
      'to-step-id': transition.toStepId,
      count: served.count(
        entry.transitions.get(`${transition.fromStepId}>${transition.toStepId}`) ?? '',
      ),
    })),
    paths: entry.figures.paths.map((path, rank) => ({
      'step-ids': [...path.stepIds],
      count: served.count(entry.paths.get(String(rank)) ?? ''),
    })),
  }));
  return {
    data: {
      type: 'analytics-funnel' as const,
      id,
      attributes: {
        ...common(context, window, bucket, served),
        buckets,
        totals: { 'step-data-from': context.stepDataFrom, versions },
      },
    },
  };
}

// Verifications and checks (one table, C164.3, C164.4) --------------------------------------------

const ATTEMPT_KEYS = [
  'created',
  'submitted',
  'passed',
  'failed',
  'requires-retry',
  'skipped',
  'needs-review',
  'canceled',
] as const;
const STEP_KEYS = [
  'step-entered',
  'step-passed',
  'step-failed-after-attempts',
  'step-needs-review',
  'step-skipped',
] as const;
const STEP_FIELDS: Record<(typeof STEP_KEYS)[number], string> = {
  'step-entered': 'entered',
  'step-passed': 'passed',
  'step-failed-after-attempts': 'failedAfterAttempts',
  'step-needs-review': 'needsReview',
  'step-skipped': 'skipped',
};
const CHECK_STATUS_KEYS = [
  'passed',
  'failed',
  'not-applicable',
  'errored',
  'not-configured',
  'pending',
] as const;
const ATTEMPT_RELATIONS = ANALYTICS_RELATIONS.verifications.filter(
  (relation) => !relation.total.startsWith('step-'),
);
const STEP_RELATIONS = ANALYTICS_RELATIONS.verifications.filter((relation) =>
  relation.total.startsWith('step-'),
);

/** The API spelling of a verification type (`government_id` is `government-id`). */
const typeName = (type: string) => type.replace(/_/g, '-');

const sum = (rows: readonly AnyRow[], field: string, liveDays: ReadonlySet<string>) =>
  rows.reduce(
    (total, row) => total + (liveDays.has(row.day as string) ? 0 : Number(row[field] ?? 0)),
    0,
  );

interface VerificationCells {
  groups: {
    type: string;
    captureMethod: string | null;
    country: string | null;
    cell: (key: string) => string;
  }[];
  steps: { version: string; stepId: string; type: string; cell: (key: string) => string }[];
  checks: {
    name: string;
    type: string;
    requirement: 'required' | 'not_required';
    ran: boolean;
    cell: (key: string) => string;
    reasons: { reason: string; cell: string }[];
    failedVerifications: string;
    share: boolean;
  }[];
}

/**
 * The verification attempts by group, the per-person step outcomes and every check's results in one
 * table: the attempt series and their relations, each group's cells summing to the window's series
 * total, each step's outcome relation, each check's statuses summing to its runs and the checks'
 * runs and failures summing to the window's check series, and each type's failed verifications (a
 * check's share's denominator) the sum of that type's groups.
 */
function verificationTable(
  context: AnalyticsReadContext,
  window: AnalyticsWindow,
): { table: AnalyticsTable; cells: VerificationCells } {
  const { liveDays } = window;
  const attempts = window.rows.verification ?? [];
  const stepRows = window.rows.verificationStep ?? [];
  const checkRows = (window.rows.check ?? []).filter(
    (row) => !liveDays.has(row.day as string),
  ) as unknown as AnalyticsCheckDailyRow[];
  const reasonRows = (window.rows.checkReason ?? []).filter(
    (row) => !liveDays.has(row.day as string),
  ) as unknown as AnalyticsCheckReasonDailyRow[];
  const time = lattice(window);
  const series: Series = new Map([
    ...seriesOf(attempts, ATTEMPT_KEYS, liveDays, 'verifications.'),
    ...seriesOf(
      checkRows.map((row) => ({
        ...row,
        runs: row.count,
        failed: row.status === 'failed' ? row.count : 0,
      })),
      ['runs', 'failed'],
      liveDays,
      'checks.',
    ),
  ]);
  const values = new Map<string, number>();
  const groups: AnalyticsAdditiveGroup[] = [];
  const cells: VerificationCells = { groups: [], steps: [], checks: [] };

  const byGroup = new Map<string, AnyRow[]>();
  for (const row of attempts) {
    const key = JSON.stringify([row.verificationType, row.captureMethod, row.country]);
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  const failedOfType = new Map<string, string[]>();
  [...byGroup.keys()].sort().forEach((key, index) => {
    const rows = byGroup.get(key) ?? [];
    const [type, captureMethod, country] = JSON.parse(key) as [
      string,
      string | null,
      string | null,
    ];
    const cell = (metric: string) => `verifications.g${String(index)}.${metric}`;
    for (const metric of ATTEMPT_KEYS) {
      values.set(cell(metric), sum(rows, fieldOf(metric), liveDays));
    }
    groups.push(...settledGroups(values, analyticsRelationGroups(ATTEMPT_RELATIONS, cell)));
    failedOfType.set(type, [...(failedOfType.get(type) ?? []), cell('failed')]);
    cells.groups.push({ type, captureMethod, country, cell });
  });
  for (const metric of ATTEMPT_KEYS) {
    if (cells.groups.length > 0) {
      groups.push({
        total: analyticsSeriesCellId(`verifications.${metric}`, time.total),
        parts: cells.groups.map((group) => group.cell(metric)),
      });
    }
  }

  const bySteps = new Map<string, AnyRow[]>();
  for (const row of stepRows) {
    const key = JSON.stringify([row.inquiryTemplateVersionId, row.stepId, row.verificationType]);
    bySteps.set(key, [...(bySteps.get(key) ?? []), row]);
  }
  [...bySteps.keys()].sort().forEach((key, index) => {
    const rows = bySteps.get(key) ?? [];
    const [version, stepId, type] = JSON.parse(key) as [string, string, string];
    const cell = (metric: string) => `verifications.s${String(index)}.${metric}`;
    for (const metric of STEP_KEYS) {
      values.set(cell(metric), sum(rows, STEP_FIELDS[metric], liveDays));
    }
    groups.push(...settledGroups(values, analyticsRelationGroups(STEP_RELATIONS, cell)));
    cells.steps.push({ version, stepId, type, cell });
  });

  for (const [type, parts] of failedOfType) {
    const total = `verifications.failed-of.${type}`;
    values.set(
      total,
      parts.reduce((count, part) => count + (values.get(part) ?? 0), 0),
    );
    groups.push({ total, parts });
  }
  const byCheck = new Map<string, AnalyticsCheckDailyRow[]>();
  for (const row of checkRows) {
    const key = JSON.stringify([row.checkName, row.verificationType, row.requirement]);
    byCheck.set(key, [...(byCheck.get(key) ?? []), row]);
  }
  [...byCheck.keys()].sort().forEach((key, index) => {
    const results = byCheck.get(key) ?? [];
    const [name, type, requirement] = JSON.parse(key) as [
      string,
      string,
      'required' | 'not_required',
    ];
    const failedVerifications = `verifications.failed-of.${type}`;
    if (!values.has(failedVerifications)) {
      values.set(failedVerifications, 0);
    }
    const figures = checkFigures(
      results,
      // AL7 (K9-24): the reasons of this use of the check only.
      reasonRows.filter(
        (row) =>
          row.checkName === name &&
          row.verificationType === type &&
          row.requirement === requirement,
      ),
      values.get(failedVerifications) ?? 0,
    );
    const cell = (metric: string) => `checks.c${String(index)}.${metric}`;
    const ran = 'runs' in figures.counts;
    const reasons: VerificationCells['checks'][number]['reasons'] = [];
    if (ran) {
      for (const metric of ['runs', ...CHECK_STATUS_KEYS]) {
        values.set(cell(metric), figures.counts[metric] ?? 0);
      }
      groups.push({ total: cell('runs'), parts: CHECK_STATUS_KEYS.map(cell) });
      for (const [metric, count] of Object.entries(figures.counts)) {
        if (metric.startsWith('reason:')) {
          const reason = metric.slice('reason:'.length);
          values.set(cell(metric), count);
          reasons.push({ reason, cell: cell(metric) });
        }
      }
    }
    cells.checks.push({
      name,
      type,
      requirement,
      ran,
      cell,
      reasons,
      failedVerifications,
      share: 'failure-share' in figures.rates,
    });
  });
  // A registry check of a type attempted in the window that wrote no result is "not run" (C164.4),
  // never zero failures: listed with no counts. Its requirement is the registry's default.
  const listed = new Set(cells.checks.map((check) => `${check.name}|${check.type}`));
  for (const type of [...new Set(cells.groups.map((group) => group.type))].sort()) {
    if (!(VERIFICATION_TYPES as readonly string[]).includes(type)) {
      continue;
    }
    for (const definition of listChecks(type as VerificationType)) {
      if (!definition.defaultEnabled || listed.has(`${definition.id}|${type}`)) {
        continue;
      }
      cells.checks.push({
        name: definition.id,
        type,
        requirement: definition.defaultRequired ? 'required' : 'not_required',
        ran: false,
        cell: (metric) => `checks.unrun.${definition.id}.${type}.${metric}`,
        reasons: [],
        failedVerifications: `verifications.failed-of.${type}`,
        share: false,
      });
    }
  }
  for (const metric of ['runs', 'failed'] as const) {
    const ran = cells.checks.filter((check) => check.ran);
    if (ran.length > 0) {
      groups.push({
        total: analyticsSeriesCellId(`checks.${metric}`, time.total),
        parts: ran.map((check) => check.cell(metric)),
      });
    }
  }
  const settled = settledSeries(series, prefixed(ATTEMPT_RELATIONS, 'verifications.'));
  const table = suppressAnalyticsTable({
    threshold: context.threshold,
    lattice: time,
    series: settled.series,
    relations: settled.relations,
    cells: values,
    groups,
  });
  return { table, cells };
}

export function verificationsAnswer(input: AnswerInput) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const rows = window.rows.verification ?? [];
  const { table, cells } = verificationTable(context, window);
  const served = new Served(table);
  const buckets = analyticsBucketNodes(time, bucket).map((node) => {
    const shape = bucketOf(node, window, rows, context);
    return {
      ...shape,
      // A live day serves no attempt count: none is a live count (C163.4).
      counts: shape.live
        ? {}
        : Object.fromEntries(
            ATTEMPT_KEYS.map((key) => [
              key,
              served.count(analyticsSeriesCellId(`verifications.${key}`, node)),
            ]),
          ),
    };
  });
  const groups = cells.groups.map((group) => ({
    'verification-type': typeName(group.type),
    'capture-method': group.captureMethod as 'upload' | 'camera' | null,
    country: group.country,
    counts: Object.fromEntries(ATTEMPT_KEYS.map((key) => [key, served.count(group.cell(key))])),
    rates: {
      'pass-rate-per-attempt': served.rate(
        [group.cell('passed')],
        ['passed', 'failed', 'requires-retry'].map(group.cell),
      ),
    },
  }));
  const steps = cells.steps.map((step) => ({
    'inquiry-template-version-id': step.version,
    'step-id': step.stepId,
    'verification-type': typeName(step.type),
    counts: Object.fromEntries(STEP_KEYS.map((key) => [key, served.count(step.cell(key))])),
    rates: {
      'pass-rate-per-person': served.rate([step.cell('step-passed')], [step.cell('step-entered')]),
    },
  }));
  return {
    data: {
      type: 'analytics-verifications' as const,
      id,
      attributes: {
        ...common(context, window, bucket, served),
        buckets,
        totals: { groups, steps },
      },
    },
  };
}

/** A check's tier and stage, from the registry (an unregistered name reads as beta, with no tier). */
function checkTierOf(name: string): { tier: string; stage: (typeof CHECK_STAGES)[number] } {
  const definition = getCheckDefinition(name);
  if (definition === undefined) {
    return { tier: '', stage: 'beta' };
  }
  const tier =
    definition.alternateTier === undefined
      ? definition.tier
      : `${definition.tier}/${definition.alternateTier}`;
  return { tier, stage: definition.stage };
}

const REASON_FORM = /^[a-z][a-z0-9_]{0,79}$/;

export function checksAnswer(input: AnswerInput) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const rows = window.rows.check ?? [];
  const { table, cells } = verificationTable(context, window);
  const served = new Served(table);
  const buckets = analyticsBucketNodes(time, bucket).map((node) => {
    const shape = bucketOf(node, window, rows, context);
    return {
      ...shape,
      counts: shape.live
        ? {}
        : {
            runs: served.count(analyticsSeriesCellId('checks.runs', node)),
            failed: served.count(analyticsSeriesCellId('checks.failed', node)),
          },
    };
  });
  const checks = cells.checks.map((check) => ({
    'check-name': check.name,
    'verification-type': typeName(check.type),
    requirement: check.requirement,
    ...checkTierOf(check.name),
    ran: check.ran,
    counts: check.ran
      ? {
          runs: served.count(check.cell('runs')),
          ...Object.fromEntries(
            CHECK_STATUS_KEYS.map((key) => [key, served.count(check.cell(key))]),
          ),
          'failed-verifications': served.count(check.failedVerifications),
        }
      : {},
    rates:
      check.ran && check.share
        ? {
            'failure-share': served.rate([check.cell('failed')], [check.failedVerifications]),
          }
        : {},
    reasons: check.reasons
      .filter((reason) => REASON_FORM.test(reason.reason))
      .map((reason) => ({ reason: reason.reason, count: served.count(reason.cell) })),
  }));
  return {
    data: {
      type: 'analytics-checks' as const,
      id,
      attributes: { ...common(context, window, bucket, served), buckets, totals: { checks } },
    },
  };
}

// Cases (C164.5; review P20) -----------------------------------------------------------------------

const CASE_KEYS = ['created', 'resolved', 'sla-met', 'sla-missed'] as const;

export function casesAnswer(input: AnswerInput, withAssignees: boolean) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const rows = window.rows.case ?? [];
  const assigneeRows = (window.rows.assignee ?? []).filter(
    (row) => !window.liveDays.has(row.day as string),
  ) as unknown as AnalyticsCaseAssigneeDailyRow[];
  const values = new Map<string, number>();
  const assignees = withAssignees ? caseAssigneeFigures(assigneeRows) : [];
  assignees.forEach((assignee, index) => {
    values.set(`cases.a${String(index)}.assigned`, assignee.figures.counts.assigned ?? 0);
    values.set(`cases.a${String(index)}.resolved`, assignee.figures.counts.resolved ?? 0);
  });
  const table = suppressAnalyticsTable({
    threshold: context.threshold,
    lattice: time,
    series: seriesOf(rows, CASE_KEYS, window.liveDays),
    cells: values,
  });
  const served = new Served(table);
  const countsAt = (node: AnalyticsTimeNode, live: boolean) =>
    Object.fromEntries(
      CASE_KEYS.filter((key) => !live || LIVE_KEYS.has(key)).map((key) => [
        key,
        served.count(analyticsSeriesCellId(key, node)),
      ]),
    );
  const buckets = analyticsBucketNodes(time, bucket).map((node) => {
    const shape = bucketOf(node, window, rows, context);
    return { ...shape, counts: countsAt(node, shape.live) };
  });
  const histogram = histogramOf(
    rows,
    'resolutionSecondsHistogram',
    new Set(time.total.days),
    window.liveDays,
  );
  const totals = {
    counts: countsAt(time.total, false),
    'resolution-time': {
      median: suppressDuration(histogram, 50, context.threshold),
      p90: suppressDuration(histogram, 90, context.threshold),
    },
    // Review P20: only for a reader who holds users:write; never exported by name.
    assignees: withAssignees
      ? assignees.map((assignee, index) => ({
          'user-id': assignee.userId,
          counts: {
            assigned: served.count(`cases.a${String(index)}.assigned`),
            resolved: served.count(`cases.a${String(index)}.resolved`),
          },
        }))
      : null,
  };
  return {
    data: {
      type: 'analytics-cases' as const,
      id,
      attributes: { ...common(context, window, bucket, served), buckets, totals },
    },
  };
}

// Signals (C164.6) ---------------------------------------------------------------------------------

/** One population every signal's bins sum to: each inquiry counts once per signal. */
const POPULATION = 'signals.population';

export function signalsAnswer(input: AnswerInput) {
  const { context, window, bucket, id } = input;
  const time = lattice(window);
  const rows = (window.rows.signal ?? []).filter(
    (row) => !window.liveDays.has(row.day as string),
  ) as unknown as AnalyticsSignalDailyRow[];
  const values = new Map<string, number>();
  const groups: AnalyticsAdditiveGroup[] = [];
  const signals = SIGNAL_REGISTRY.map((signal, index) => {
    const figures = signalFigures(rows.filter((row) => row.signalName === signal.name));
    const entry = SIGNAL_BINS[signal.name];
    const bins =
      Object.keys(figures.counts).length > 0
        ? Object.keys(figures.counts).filter((bin) => bin !== SIGNAL_NOT_EVALUATED_BIN)
        : entry?.kind === 'fixed'
          ? [...entry.bins]
          : [];
    const cell = (bin: string) => `signals.${String(index)}.${bin}`;
    for (const bin of [...bins, SIGNAL_NOT_EVALUATED_BIN]) {
      values.set(cell(bin), figures.counts[bin] ?? 0);
    }
    groups.push({ total: POPULATION, parts: [...bins, SIGNAL_NOT_EVALUATED_BIN].map(cell) });
    return { signal, bins, cell };
  });
  const table = suppressAnalyticsTable({
    threshold: context.threshold,
    lattice: time,
    cells: values,
    groups,
    virtual: [POPULATION],
  });
  const served = new Served(table);
  const buckets = analyticsBucketNodes(time, bucket).map((node) =>
    bucketOf(node, window, window.rows.signal ?? [], context),
  );
  const totals = {
    signals: signals.map(({ signal, bins, cell }) => ({
      name: signal.name,
      tier: signal.tier,
      stage: signal.stage,
      bins: bins.map((bin) => ({ bin, count: served.count(cell(bin)) })),
      'not-evaluated': served.count(cell(SIGNAL_NOT_EVALUATED_BIN)),
    })),
  };
  return {
    data: {
      type: 'analytics-signals' as const,
      id,
      attributes: { ...common(context, window, bucket, served), buckets, totals },
    },
  };
}
