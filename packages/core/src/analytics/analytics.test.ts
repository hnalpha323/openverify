/**
 * C163, C164 (Workflow 9B Stage 1a, (A)): the frozen analytics vocabulary, the metric definitions as
 * documented constants, the rollup tables, the signal bins and the duration constants. Read through
 * the package root, so the index line is held too. `analytics-logic` (Stage 2) replaced the stub
 * tests that ended this file with the tests beside each module, its property tests
 * (`suppression-properties.test.ts`) and its golden vectors (`golden.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import * as core from '../index.js';

const pick = (name: string): unknown => (core as Readonly<Record<string, unknown>>)[name];

interface Metric {
  key: string;
  report: string;
  kind: 'count' | 'rate' | 'duration';
  unit: string;
  definition: string;
  numerator?: readonly string[];
  denominator?: readonly string[];
  live?: true;
}

const metrics = (): readonly Metric[] =>
  (pick('ANALYTICS_METRICS') as readonly Metric[] | undefined) ?? [];
const keysOf = (report: string, kind?: Metric['kind']) =>
  metrics()
    .filter((metric) => metric.report === report && (kind === undefined || metric.kind === kind))
    .map((metric) => metric.key);

describe('the analytics vocabulary (C163.2, C163.3, C163.4, C164.8)', () => {
  it('names the six answers, the buckets, the window and the rollup sources', () => {
    expect(pick('ANALYTICS_REPORTS')).toEqual([
      'inquiries',
      'funnel',
      'verifications',
      'checks',
      'cases',
      'signals',
    ]);
    expect(pick('ANALYTICS_BUCKETS')).toEqual(['day', 'week', 'month']);
    expect(pick('ANALYTICS_MAX_RANGE_DAYS')).toBe(400);
    expect(pick('ANALYTICS_ROLLUP_SOURCES')).toEqual(['facts', 'redacted']);
  });

  it('counts an outage as its own check status, never as not applicable (review H03)', () => {
    expect(pick('ANALYTICS_CHECK_STATUSES')).toEqual([
      'passed',
      'failed',
      'not_applicable',
      'errored',
      'not_configured',
      'pending',
    ]);
  });

  it('takes the platform and device kind of the flow records (C163.3)', () => {
    expect(pick('ANALYTICS_PLATFORMS')).toEqual(core.FLOW_RECORD_PLATFORMS);
    expect(pick('ANALYTICS_DEVICE_KINDS')).toEqual(core.FLOW_RECORD_DEVICE_KINDS);
  });

  it('lists the twelve rollup tables of C163.3', () => {
    expect(pick('ANALYTICS_ROLLUP_TABLES')).toEqual([
      'analytics_inquiry_daily',
      'analytics_inquiry_tag_daily',
      'analytics_step_daily',
      'analytics_transition_daily',
      'analytics_path_daily',
      'analytics_verification_daily',
      'analytics_verification_step_daily',
      'analytics_check_daily',
      'analytics_check_reason_daily',
      'analytics_case_daily',
      'analytics_case_assignee_daily',
      'analytics_signal_daily',
    ]);
  });
});

describe('the metric definitions (C164.1-C164.6)', () => {
  it('defines the inquiry metrics of C164.1, success always split three ways (review H09)', () => {
    expect(keysOf('inquiries', 'count')).toEqual([
      'created',
      'started',
      'interacted',
      'finished',
      'completed',
      'completed-verified',
      'completed-with-fallback',
      'completed-unverified',
      'failed',
      'expired-before-start',
      'expired-after-start',
      'approved',
      'declined',
      'needs-review',
      'marked-for-review',
      'decided-automatic',
      'decided-manual',
      'decided-not-declared',
    ]);
    expect(keysOf('inquiries', 'rate')).toEqual([
      'success-rate',
      'completed-verified-rate',
      'completed-with-fallback-rate',
      'completed-unverified-rate',
      'rejected-rate',
      'needs-review-rate',
      'expiration-rate',
    ]);
    expect(keysOf('inquiries', 'duration')).toEqual(['time-to-finish']);
  });

  it('puts the expiration rate over started inquiries, so it never passes 100% (review H05)', () => {
    const expiration = metrics().find((metric) => metric.key === 'expiration-rate');
    expect(expiration).toMatchObject({
      numerator: ['expired-after-start'],
      denominator: ['started'],
    });
  });

  it('gives verifications a per-attempt and a per-person rate, each with its unit (review H06)', () => {
    const rate = (key: string) => metrics().find((metric) => metric.key === key);
    expect(rate('pass-rate-per-attempt')).toMatchObject({
      unit: 'attempts',
      numerator: ['passed'],
      denominator: ['passed', 'failed', 'requires-retry'],
    });
    expect(rate('pass-rate-per-person')).toMatchObject({
      unit: 'people-and-steps',
      numerator: ['step-passed'],
      denominator: ['step-entered'],
    });
  });

  it('gives each check status a count of its own, and a funnel share over transitions (H03, H17)', () => {
    expect(keysOf('checks', 'count')).toEqual([
      'runs',
      'passed',
      'failed',
      'not-applicable',
      'errored',
      'not-configured',
      'pending',
      'failed-verifications',
    ]);
    expect(metrics().find((metric) => metric.key === 'step-share')).toMatchObject({
      report: 'funnel',
      numerator: ['entered'],
      denominator: ['transitions'],
    });
    expect(keysOf('cases')).toEqual([
      'created',
      'resolved',
      'sla-met',
      'sla-missed',
      'resolution-time',
      'assigned',
    ]);
    expect(keysOf('signals')).toEqual(['values']);
  });

  it('states every definition, and draws every rate from counts of its own answer', () => {
    const seen = new Set<string>();
    for (const metric of metrics()) {
      expect(metric.definition.length, metric.key).toBeGreaterThan(10);
      expect(metric.definition, metric.key).toMatch(/\.$/);
      const id = `${metric.report}/${metric.key}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      if (metric.kind === 'rate') {
        const counts = keysOf(metric.report, 'count');
        for (const key of [...(metric.numerator ?? []), ...(metric.denominator ?? [])]) {
          expect(counts, `${metric.key}: ${key}`).toContain(key);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it('serves only created and started live, never an outcome (reviews H28, P21)', () => {
    const live = metrics()
      .filter((metric) => metric.live === true)
      .map((metric) => `${metric.report}/${metric.key}`);
    expect(live).toEqual(['inquiries/created', 'inquiries/started', 'cases/created']);
  });
});

describe('the signal bins (C164.6)', () => {
  const bins = () =>
    (pick('SIGNAL_BINS') ?? {}) as Readonly<
      Record<string, { kind: string; bins?: readonly string[] }>
    >;

  it('bins every signal of the registry, and only those', () => {
    expect(Object.keys(bins()).sort()).toEqual(
      core.SIGNAL_REGISTRY.map((signal) => signal.name).sort(),
    );
    expect(pick('SIGNAL_NOT_EVALUATED_BIN')).toBe('not-evaluated');
  });

  it('gives an enum signal one bin per registry value, and the country signal its codes', () => {
    for (const signal of core.SIGNAL_REGISTRY) {
      const entry = bins()[signal.name];
      if (signal.valueType === 'enum') {
        expect(entry, signal.name).toEqual({ kind: 'fixed', bins: signal.values });
      }
    }
    expect(bins()['inquiry/country_from_session']).toEqual({ kind: 'country' });
    expect(bins()['inquiry/bot_score']?.bins).toHaveLength(10);
  });

  it('never bins a null value: not-evaluated is no fixed bin', () => {
    for (const entry of Object.values(bins())) {
      expect(entry.bins ?? []).not.toContain('not-evaluated');
    }
  });
});

describe('the duration buckets and the suppression floor (C163.5, C164.7)', () => {
  it('freezes 40 log-spaced buckets from 1 second to 30 days, and the floor of 11', () => {
    expect(pick('DURATION_BUCKET_COUNT')).toBe(40);
    expect(pick('DURATION_MIN_SECONDS')).toBe(1);
    expect(pick('DURATION_MAX_SECONDS')).toBe(30 * 24 * 60 * 60);
    expect(pick('ANALYTICS_SUPPRESSION_FLOOR')).toBe(11);
    expect(pick('ANALYTICS_SUPPRESSIONS')).toEqual(['small-count', 'complementary']);
  });
});

describe('what analytics-logic built, read through the package root (C164)', () => {
  it.each([
    'inquiryFigures',
    'funnelFigures',
    'verificationFigures',
    'checkFigures',
    'checkReasonKey',
    'caseFigures',
    'caseAssigneeFigures',
    'signalFigures',
    'suppressCount',
    'suppressRate',
    'suppressDuration',
    'complementarySuppression',
    'suppressAnalyticsTable',
    'analyticsSeriesCellId',
    'analyticsRelationGroups',
    'analyticsTimeLattice',
    'analyticsBucketNodes',
    'durationBuckets',
    'durationBucketOf',
    'durationPercentile',
    'signalBinOf',
    'listMatchCountValue',
  ])('exports %s', (name) => {
    expect(typeof pick(name), name).toBe('function');
  });

  it('exports the relations, the top-paths count and the input error', () => {
    expect(Object.keys(pick('ANALYTICS_RELATIONS') as object)).toEqual([
      'inquiries',
      'funnel',
      'verifications',
      'checks',
      'cases',
      'signals',
    ]);
    expect(pick('FUNNEL_TOP_PATHS')).toBe(20);
    const InputError = pick('AnalyticsInputError') as new (message: string) => Error;
    expect(new InputError('x')).toBeInstanceOf(RangeError);
  });

  it('keeps the not-built error of the stage 1a stubs, counting inputs and never keeping them', () => {
    const NotBuilt = pick('AnalyticsNotBuiltError') as new (name: string, inputs?: number) => Error;
    const notBuilt = pick('analyticsNotBuilt') as (name: string, ...inputs: unknown[]) => Error;
    expect(new NotBuilt('a')).toMatchObject({ owner: 'analytics-logic', inputs: 0 });
    expect(notBuilt('b', 1, 2)).toMatchObject({ inputs: 2, name: 'AnalyticsNotBuiltError' });
  });
});
