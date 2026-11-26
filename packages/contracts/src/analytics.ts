/**
 * C164.8 (Phase 9, Workflow 9B Stage 1a, (A); A12, A13): the read-only aggregates API, ours (the
 * public product has none). `GET /api/v1/analytics/{inquiries,funnel,verifications,checks,cases,
 * signals}` under `analytics:read`, rate limit `analytics`, always the caller's one environment, so
 * sandbox and production never mix. `foundation-9b` (A) freezes the routes in
 * `routes/server/analytics.ts`; `api-analytics` serves them.
 *
 * Every answer states its window and time zone, the threshold and how many cells it hid, and its
 * freshness, and carries counts only after suppression (C164.7): a visible count is 0 or at least
 * the threshold, which the document schema refuses otherwise, so no path can serve an unsuppressed
 * small count. The metric keys and their definitions are `ANALYTICS_METRICS` (`@openverify/core`).
 */
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_MAX_RANGE_DAYS,
  ANALYTICS_REPORTS,
  ANALYTICS_SUPPRESSIONS,
  CHECK_STAGES,
  FILE_CAPTURE_METHODS,
  FLOW_RECORD_DEVICE_KINDS,
  FLOW_RECORD_PLATFORMS,
  SIGNAL_TIERS,
  analyticsMetricsOf,
  type AnalyticsReport,
} from '@openverify/core';
import { z } from 'zod';
import { analyticsTimeZoneSchema } from './dashboard-api.js';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';
import { tagSchema } from './tags.js';

export { ANALYTICS_REPORTS };

/** A local date in the reporting time zone, `YYYY-MM-DD`. */
export const analyticsDateSchema = z.iso.date();

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

const windowShape = {
  'filter[from]': analyticsDateSchema,
  'filter[to]': analyticsDateSchema,
  /** `day` when absent. A week starts on Monday (ISO 8601). */
  bucket: z.enum(ANALYTICS_BUCKETS).optional(),
};

const inquiryFilterShape = {
  'filter[inquiry-template-id]': idSchema('itmpl').optional(),
  'filter[inquiry-template-version-id]': idSchema('itmplv').optional(),
  /** The inquiry's first platform (C151.1). */
  'filter[platform]': z.enum(FLOW_RECORD_PLATFORMS).optional(),
  /** The inquiry's first device kind (C150.2, review H27). */
  'filter[device-kind]': z.enum(FLOW_RECORD_DEVICE_KINDS).optional(),
};

/** Whole local days, both ends included, at most `ANALYTICS_MAX_RANGE_DAYS`. */
function inWindow(query: { 'filter[from]': string; 'filter[to]': string }, ctx: z.RefinementCtx) {
  const days = dayNumber(query['filter[to]']) - dayNumber(query['filter[from]']) + 1;
  if (days < 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['filter[to]'],
      message: 'must not be before filter[from]',
    });
  } else if (days > ANALYTICS_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['filter[to]'],
      message: `the window is at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days`,
    });
  }
}

/** `GET /analytics/inquiries`; `filter[tag]` is a tag's name (review F14). */
export const analyticsInquiriesQuerySchema = z
  .strictObject({ ...windowShape, ...inquiryFilterShape, 'filter[tag]': tagSchema.optional() })
  .superRefine(inWindow);
export const analyticsFunnelQuerySchema = z
  .strictObject({ ...windowShape, ...inquiryFilterShape })
  .superRefine(inWindow);
export const analyticsVerificationsQuerySchema = z
  .strictObject({ ...windowShape, ...inquiryFilterShape })
  .superRefine(inWindow);
export const analyticsChecksQuerySchema = z
  .strictObject({ ...windowShape, ...inquiryFilterShape })
  .superRefine(inWindow);
export const analyticsSignalsQuerySchema = z
  .strictObject({ ...windowShape, ...inquiryFilterShape })
  .superRefine(inWindow);
/** `GET /analytics/cases`: cases count on their own creation day, by case template (C164.5). */
export const analyticsCasesQuerySchema = z
  .strictObject({ ...windowShape, 'filter[case-template-id]': idSchema('ctmpl').optional() })
  .superRefine(inWindow);
export type AnalyticsInquiriesQuery = z.infer<typeof analyticsInquiriesQuerySchema>;
export type AnalyticsCasesQuery = z.infer<typeof analyticsCasesQuerySchema>;

// Cells (C164.7) ---------------------------------------------------------------------------

/**
 * A count: shown (0, or at least the threshold), or hidden. `small-count` reads "fewer than
 * <threshold>"; `complementary` reads "hidden", because the value may be large.
 */
export const analyticsCountCellSchema = z.union([
  z.int().min(0),
  z.strictObject({ suppressed: z.enum(ANALYTICS_SUPPRESSIONS) }),
]);

/**
 * A rate: a fraction in [0, 1] when its denominator, numerator and complement each reach the
 * threshold; otherwise a bound rounded outward to a whole percent ("under 5%", "over 95%"), or
 * nothing when the denominator itself is small.
 */
export const analyticsRateCellSchema = z.union([
  z.strictObject({ value: z.number().min(0).max(1) }),
  z.strictObject({ below: z.int().min(1).max(100) }),
  z.strictObject({ above: z.int().min(0).max(99) }),
  z.strictObject({ suppressed: z.literal(true) }),
]);

/**
 * A bucketed duration (C163.5): the bounds in seconds of the bucket that holds the figure, labelled
 * approximate; hidden when too few are counted; `null` when nothing was counted.
 */
export const analyticsDurationCellSchema = z
  .union([
    z.strictObject({ lower: z.number().min(0), upper: z.number().positive() }),
    z.strictObject({ suppressed: z.literal(true) }),
  ])
  .nullable();

const keysOf = (report: AnalyticsReport, kind: 'count' | 'rate') =>
  analyticsMetricsOf(report)
    .filter((metric) => metric.kind === kind)
    .map((metric) => metric.key);

const cells = <Cell extends z.ZodType>(keys: readonly string[], cell: Cell) =>
  z.strictObject(Object.fromEntries(keys.map((key) => [key, cell.optional()])));

const countsOf = (report: AnalyticsReport, only?: readonly string[]) =>
  cells(only ?? keysOf(report, 'count'), analyticsCountCellSchema);
const ratesOf = (report: AnalyticsReport, only?: readonly string[]) =>
  cells(only ?? keysOf(report, 'rate'), analyticsRateCellSchema);

/** Members whose numbers are not counts: rates, and durations' bounds in seconds. */
const NOT_COUNTS: ReadonlySet<string> = new Set(['rates', 'time-to-finish', 'resolution-time']);

/** C163.4: the live counts, the only ones a live day carries. */
const LIVE_COUNTS = ['created', 'started'] as const;

// Answers ----------------------------------------------------------------------------------

/** C163.4: when the answer's rollups were last refreshed, and its open days' outcomes. */
export const analyticsFreshnessSchema = z.strictObject({
  /** Every count up to this instant is rolled up; later activity is not in the answer yet. */
  'rolled-up-through': timestampSchema.nullable(),
  /** The outcome columns of open days were last recomputed then (once a local day, review P21). */
  'outcomes-as-of': timestampSchema.nullable(),
});

const bucketShape = {
  /** The first and last local day of the bucket, both included. */
  start: analyticsDateSchema,
  end: analyticsDateSchema,
  /** The zone the bucket was computed in (C163.2): a range may mix zones after a change. */
  'time-zone': analyticsTimeZoneSchema,
  /** The current local day, computed on the fly and never stored: created and started only. */
  live: z.boolean(),
};

const attributesShape = {
  'time-zone': analyticsTimeZoneSchema,
  /** Every zone the buckets were computed in; more than one marks a mixed range. */
  'time-zones': z.array(analyticsTimeZoneSchema).min(1).max(16),
  from: analyticsDateSchema,
  to: analyticsDateSchema,
  bucket: z.enum(ANALYTICS_BUCKETS),
  /** `analytics-suppression-threshold`: counts from 1 to `threshold - 1` are never shown. */
  threshold: z.int().min(11).max(100),
  'suppressed-cells': z.int().min(0),
  /** `analytics-settle-days` (C163.4): a day is frozen this many days after it. */
  'settle-days': z.int().min(1).max(90),
  freshness: analyticsFreshnessSchema,
};

/** The answer's id: the SHA-256 of the canonical query. */
const answerIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Every count cell in `value` is 0, at least `threshold`, or hidden; a live bucket holds the live
 * counts only.
 */
function suppressed(
  threshold: number,
  value: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < threshold) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `a count from 1 to ${String(threshold - 1)} is shown only as suppressed`,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      suppressed(threshold, item, [...path, index], ctx);
    });
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.live === true && typeof record.counts === 'object' && record.counts !== null) {
      for (const key of Object.keys(record.counts)) {
        if (!(LIVE_COUNTS as readonly string[]).includes(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'counts', key],
            message: 'a live day carries created and started only',
          });
        }
      }
    }
    for (const [key, member] of Object.entries(record)) {
      // Rates and durations hold no count.
      if (NOT_COUNTS.has(key)) {
        continue;
      }
      suppressed(threshold, member, [...path, key], ctx);
    }
  }
}

function answer<Report extends AnalyticsReport, Shape extends z.ZodRawShape>(
  report: Report,
  shape: Shape,
) {
  return z
    .strictObject({
      data: z.strictObject({
        type: z.literal(`analytics-${report}`),
        id: answerIdSchema,
        attributes: z.strictObject({ ...attributesShape, ...shape }),
      }),
    })
    .superRefine((document, ctx) => {
      const { attributes } = document.data as { attributes: Record<string, unknown> };
      const threshold = attributes.threshold as number;
      for (const [key, member] of Object.entries(attributes)) {
        if (key === 'buckets' || key === 'totals') {
          suppressed(threshold, member, ['data', 'attributes', key], ctx);
        }
      }
    });
}

/** C164.1: inquiries by bucket and in total. */
export const analyticsInquiriesDocumentSchema = answer('inquiries', {
  buckets: z.array(
    z.strictObject({
      ...bucketShape,
      counts: countsOf('inquiries'),
      /** Absent on a live day, which serves no outcome. */
      rates: ratesOf('inquiries').optional(),
      'time-to-finish': analyticsDurationCellSchema.optional(),
    }),
  ),
  totals: z.strictObject({
    counts: countsOf('inquiries'),
    rates: ratesOf('inquiries'),
    'time-to-finish': analyticsDurationCellSchema,
  }),
});

/** C164.2: the funnel per version; a bucket before the first step record has no step data. */
export const analyticsFunnelDocumentSchema = answer('funnel', {
  buckets: z.array(
    z.strictObject({
      ...bucketShape,
      /** `false`: the bucket precedes the environment's first step record ("no step data"). */
      'step-data': z.boolean(),
      counts: countsOf('funnel', ['started']),
    }),
  ),
  totals: z.strictObject({
    /** The environment's first local day with a step record, `null` when none yet. */
    'step-data-from': analyticsDateSchema.nullable(),
    versions: z.array(
      z.strictObject({
        'inquiry-template-version-id': idSchema('itmplv'),
        counts: countsOf('funnel', ['started']),
        steps: z.array(
          z.strictObject({
            'step-id': z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
            counts: countsOf('funnel', ['entered', 'exited', 'revisits']),
            rates: ratesOf('funnel'),
          }),
        ),
        transitions: z.array(
          z.strictObject({
            'from-step-id': z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
            'to-step-id': z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
            count: analyticsCountCellSchema,
          }),
        ),
        /** The 20 most frequent sequences of person-visible steps. */
        paths: z
          .array(
            z.strictObject({
              'step-ids': z
                .array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/))
                .min(1)
                .max(400),
              count: analyticsCountCellSchema,
            }),
          )
          .max(20),
      }),
    ),
  }),
});

const verificationAttemptCounts = [
  'created',
  'submitted',
  'passed',
  'failed',
  'requires-retry',
  'skipped',
  'needs-review',
  'canceled',
] as const;
const verificationStepCounts = [
  'step-entered',
  'step-passed',
  'step-failed-after-attempts',
  'step-needs-review',
  'step-skipped',
] as const;

/** C164.3: attempts by type, capture method and country; the per-person outcome by step. */
export const analyticsVerificationsDocumentSchema = answer('verifications', {
  buckets: z.array(
    z.strictObject({
      ...bucketShape,
      counts: countsOf('verifications', verificationAttemptCounts),
    }),
  ),
  totals: z.strictObject({
    groups: z.array(
      z.strictObject({
        'verification-type': z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        /** Client-reported (C153.2); `null` when no client reported one. */
        'capture-method': z.enum(FILE_CAPTURE_METHODS).nullable(),
        /** The government ID's country, ISO 3166-1 alpha-2; `null` for other types or unknown. */
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .nullable(),
        counts: countsOf('verifications', verificationAttemptCounts),
        rates: ratesOf('verifications', ['pass-rate-per-attempt']),
      }),
    ),
    steps: z.array(
      z.strictObject({
        'inquiry-template-version-id': idSchema('itmplv'),
        'step-id': z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        'verification-type': z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        counts: countsOf('verifications', verificationStepCounts),
        rates: ratesOf('verifications', ['pass-rate-per-person']),
      }),
    ),
  }),
});

/** C164.4: per check, every status its own count, the reasons, tier and stage. */
export const analyticsChecksDocumentSchema = answer('checks', {
  buckets: z.array(
    z.strictObject({ ...bucketShape, counts: countsOf('checks', ['runs', 'failed']) }),
  ),
  totals: z.strictObject({
    checks: z.array(
      z.strictObject({
        'check-name': z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
        'verification-type': z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        requirement: z.enum(['required', 'not_required']),
        tier: z.string().max(8),
        stage: z.enum(CHECK_STAGES),
        /** `false`: no result in the window, shown "not run", never zero failures; no counts then. */
        ran: z.boolean(),
        counts: countsOf('checks'),
        rates: ratesOf('checks'),
        reasons: z.array(
          z.strictObject({
            reason: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
            count: analyticsCountCellSchema,
          }),
        ),
      }),
    ),
  }),
});

/** C164.5: cases; the per-reviewer distribution only for holders of users:write (review P20). */
export const analyticsCasesDocumentSchema = answer('cases', {
  buckets: z.array(
    z.strictObject({
      ...bucketShape,
      counts: countsOf('cases', ['created', 'resolved', 'sla-met', 'sla-missed']),
    }),
  ),
  totals: z.strictObject({
    counts: countsOf('cases', ['created', 'resolved', 'sla-met', 'sla-missed']),
    'resolution-time': z.strictObject({
      median: analyticsDurationCellSchema,
      p90: analyticsDurationCellSchema,
    }),
    /** `null` for a reader without users:write; never exported by name. */
    assignees: z
      .array(
        z.strictObject({
          /** `null` once the user is deleted ("former user"). */
          'user-id': idSchema('usr').nullable(),
          counts: countsOf('cases', ['assigned', 'resolved']),
        }),
      )
      .nullable(),
  }),
});

/** C164.6: each signal's values in the registry's fixed bins, `not-evaluated` for null. */
export const analyticsSignalsDocumentSchema = answer('signals', {
  buckets: z.array(z.strictObject(bucketShape)),
  totals: z.strictObject({
    signals: z.array(
      z.strictObject({
        name: z.string().regex(/^inquiry\/[a-z][a-z0-9_]*$/),
        tier: z.enum(SIGNAL_TIERS),
        stage: z.enum(CHECK_STAGES),
        bins: z.array(z.strictObject({ bin: z.string().max(40), count: analyticsCountCellSchema })),
        'not-evaluated': analyticsCountCellSchema,
      }),
    ),
  }),
});

export type AnalyticsInquiriesDocument = z.infer<typeof analyticsInquiriesDocumentSchema>;
export type AnalyticsFunnelDocument = z.infer<typeof analyticsFunnelDocumentSchema>;
export type AnalyticsVerificationsDocument = z.infer<typeof analyticsVerificationsDocumentSchema>;
export type AnalyticsChecksDocument = z.infer<typeof analyticsChecksDocumentSchema>;
export type AnalyticsCasesDocument = z.infer<typeof analyticsCasesDocumentSchema>;
export type AnalyticsSignalsDocument = z.infer<typeof analyticsSignalsDocumentSchema>;
