/**
 * C164.1-C164.6 (Phase 9, Workflow 9B; `analytics-logic`): each metric function against its
 * definition, computed a second time over the seeded people the rows were rolled up from, both
 * sources added (C163.4). Golden vectors of the same population are in `golden.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ANALYTICS_METRICS } from './definitions.js';
import { ANALYTICS_FLOW_START_STEP_ID } from './rows.js';
import { DURATION_BUCKET_COUNT, durationBucketOf } from './durations.js';
import {
  ANALYTICS_RELATIONS,
  caseAssigneeFigures,
  caseFigures,
  checkFigures,
  funnelFigures,
  inquiryFigures,
  signalFigures,
  verificationFigures,
} from './metrics.js';
import { SIGNAL_BINS } from './signal-bins.js';
import {
  CHECKS,
  STEPS,
  caseRows,
  checkRows,
  funnelRows,
  inquiryRows,
  pathSha256,
  population,
  signalRows,
  verificationRows,
  type Person,
} from './testing/population.js';

const { people, cases } = population(2026, 60);
const count = (predicate: (p: Person) => boolean) => people.filter(predicate).length;
const rate = (numerator: number, denominator: number) => ({ numerator, denominator });
const histogramOf = (values: readonly (number | null)[]) => {
  const histogram = Array.from({ length: DURATION_BUCKET_COUNT }, () => 0);
  for (const value of values) {
    if (value !== null) {
      histogram[durationBucketOf(value)] = (histogram[durationBucketOf(value)] ?? 0) + 1;
    }
  }
  return histogram;
};

describe('the seeded population', () => {
  it('holds both sources, every status and both outcomes of a step', () => {
    expect(people.some((p) => p.source === 'redacted')).toBe(true);
    expect(new Set(people.map((p) => p.status)).size).toBe(6);
    expect(people.filter((p) => p.path.includes('document')).length).toBeGreaterThan(50);
  });
});

describe('inquiryFigures (C164.1)', () => {
  const figures = () => inquiryFigures(inquiryRows(people));
  const finished = count((p) => p.finished);

  it('counts every inquiry metric by its definition, redacted contributions added', () => {
    expect(figures().counts).toEqual({
      created: people.length,
      started: count((p) => p.started),
      interacted: count((p) => p.interacted),
      finished,
      completed: count((p) => p.status === 'completed'),
      'completed-verified': count((p) => p.split === 'verified'),
      'completed-with-fallback': count((p) => p.split === 'with-fallback'),
      'completed-unverified': count((p) => p.split === 'unverified'),
      failed: count((p) => p.status === 'failed'),
      'expired-before-start': count((p) => p.expiredBeforeStart),
      'expired-after-start': count((p) => p.expiredAfterStart),
      approved: count((p) => p.status === 'approved'),
      declined: count((p) => p.status === 'declined'),
      'needs-review': count((p) => p.status === 'needs_review'),
      'marked-for-review': count((p) => p.markedForReview),
      'decided-automatic': count((p) => p.decided === 'automatic'),
      'decided-manual': count((p) => p.decided === 'manual'),
      'decided-not-declared': count((p) => p.decided === 'not-declared'),
    });
  });

  it('gives each rate its numerator and its denominator, never a division (review H05, H09)', () => {
    expect(figures().rates).toEqual({
      'success-rate': rate(
        count((p) => p.status === 'completed' || p.status === 'approved'),
        finished,
      ),
      'completed-verified-rate': rate(
        count((p) => p.split === 'verified'),
        finished,
      ),
      'completed-with-fallback-rate': rate(
        count((p) => p.split === 'with-fallback'),
        finished,
      ),
      'completed-unverified-rate': rate(
        count((p) => p.split === 'unverified'),
        finished,
      ),
      'rejected-rate': rate(
        count((p) => p.status === 'failed' || p.status === 'declined'),
        finished,
      ),
      'needs-review-rate': rate(
        count((p) => p.status === 'needs_review'),
        finished,
      ),
      'expiration-rate': rate(
        count((p) => p.expiredAfterStart),
        count((p) => p.started),
      ),
    });
  });

  it('adds the time-to-finish histograms', () => {
    expect(figures().histograms).toEqual({
      'time-to-finish': histogramOf(people.map((p) => p.finishSeconds)),
    });
  });

  it('answers zeros, never a missing figure, for no rows', () => {
    const empty = inquiryFigures([]);
    expect(empty.counts.created).toBe(0);
    expect(empty.rates['success-rate']).toEqual(rate(0, 0));
    expect(empty.histograms['time-to-finish']).toHaveLength(DURATION_BUCKET_COUNT);
  });

  it('keeps every relation of ANALYTICS_RELATIONS on a settled population', () => {
    const counts = inquiryFigures(
      inquiryRows(
        people.filter((p) =>
          p.started ? p.finished || p.expiredAfterStart : p.expiredBeforeStart,
        ),
      ),
    ).counts;
    for (const relation of ANALYTICS_RELATIONS.inquiries) {
      const parts = relation.parts.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
      expect(counts[relation.total], relation.total).toBe(parts);
    }
  });

  it('refuses rows of two environments, a negative count and a histogram of the wrong length', () => {
    const [row] = inquiryRows(people);
    if (row === undefined) {
      throw new Error('no row');
    }
    expect(() => inquiryFigures([row, { ...row, environmentId: 'env_synthetic2' }])).toThrow(
      RangeError,
    );
    expect(() => inquiryFigures([{ ...row, created: -1 }])).toThrow(RangeError);
    expect(() => inquiryFigures([{ ...row, finishSecondsHistogram: [1] }])).toThrow(RangeError);
  });
});

describe('funnelFigures (C164.2, review H17)', () => {
  const started = count((p) => p.started);
  const figures = () => funnelFigures(funnelRows(people), started);
  // AL6 (K9-24): an inquiry's first step is entered from the start, so it counts into that step.
  const into = (step: string) =>
    people.reduce(
      (sum, p) =>
        sum +
        (p.path[0] === step ? 1 : 0) +
        p.path.slice(1).filter((to, index) => to === step && p.path[index] !== undefined).length,
      0,
    );

  it('counts each step: first entries, exits and revisits, from the step record', () => {
    for (const step of STEPS) {
      const figure = figures().steps.find((entry) => entry.stepId === step);
      expect(figure?.figures.counts, step).toEqual({
        entered: count((p) => p.path.includes(step)),
        exited: count((p) => p.path.slice(0, -1).includes(step)),
        revisits: count((p) => p.path.filter((other) => other === step).length > 1),
      });
    }
  });

  it('shares a step over started inquiries, and over the transitions into it', () => {
    for (const step of STEPS) {
      const figure = figures().steps.find((entry) => entry.stepId === step);
      const entered = count((p) => p.path.includes(step));
      expect(figure?.figures.rates['overall-share'], step).toEqual(rate(entered, started));
      const transitions = into(step);
      if (transitions > 0 && entered <= transitions) {
        expect(figure?.figures.rates['step-share'], step).toEqual(rate(entered, transitions));
      } else {
        expect(figure?.figures.rates['step-share'], step).toBeUndefined();
      }
    }
    // AL6 (K9-24): the entry step has its transitions from the start, so it has a step share too.
    expect(figures().steps.find((entry) => entry.stepId === 'start')?.figures.rates).toHaveProperty(
      'step-share',
    );
  });

  it('lists the transitions, and the 20 most frequent paths by count then hash', () => {
    const moves = new Map<string, number>();
    const paths = new Map<string, { stepIds: readonly string[]; count: number }>();
    for (const p of people) {
      p.path.slice(1).forEach((to, index) => {
        const key = `${p.path[index] ?? ''}>${to}`;
        moves.set(key, (moves.get(key) ?? 0) + 1);
      });
      if (p.path.length > 0) {
        const sha = pathSha256(p.path);
        paths.set(sha, { stepIds: p.path, count: (paths.get(sha)?.count ?? 0) + 1 });
      }
    }
    expect(
      Object.fromEntries(
        figures().transitions.map((move) => [`${move.fromStepId}>${move.toStepId}`, move.count]),
      ),
    ).toEqual(Object.fromEntries(moves));
    const top = [...paths]
      .sort(([shaA, a], [shaB, b]) => b.count - a.count || (shaA < shaB ? -1 : 1))
      .slice(0, 20)
      .map(([, path]) => ({ stepIds: path.stepIds, count: path.count }));
    expect(figures().paths.map(({ stepIds, count: n }) => ({ stepIds, count: n }))).toEqual(top);
    expect(paths.size).toBeGreaterThan(20);
  });

  it('refuses rows of two versions, and one path hash naming two sequences', () => {
    const rows = funnelRows(people);
    const [step] = rows.steps;
    const [path] = rows.paths;
    if (step === undefined || path === undefined) {
      throw new Error('no rows');
    }
    expect(() =>
      funnelFigures(
        {
          ...rows,
          steps: [...rows.steps, { ...step, inquiryTemplateVersionId: 'itmplv_synthetic2' }],
        },
        started,
      ),
    ).toThrow(RangeError);
    expect(() =>
      funnelFigures({ ...rows, paths: [...rows.paths, { ...path, stepIds: ['other'] }] }, started),
    ).toThrow(RangeError);
    expect(() => funnelFigures(rows, -1)).toThrow(RangeError);
  });
});

describe('funnelFigures: the entry step (K9-24, AL6)', () => {
  const key = {
    environmentId: 'env_1',
    day: '2026-03-28',
    timeZone: 'UTC',
    source: 'facts' as const,
    inquiryTemplateId: 'itmpl_1',
    inquiryTemplateVersionId: 'itmplv_1',
  };
  const rows = {
    steps: [
      { ...key, stepId: 'consent', entered: 3, exited: 3, revisits: 0 },
      { ...key, stepId: 'selfie', entered: 2, exited: 2, revisits: 0 },
    ],
    transitions: [
      { ...key, fromStepId: ANALYTICS_FLOW_START_STEP_ID, toStepId: 'consent', count: 3 },
      { ...key, fromStepId: 'consent', toStepId: 'selfie', count: 2 },
    ],
    paths: [],
  };

  it('gives the entry step its step share through the transitions from the start', () => {
    const consent = funnelFigures(rows, 3).steps.find((step) => step.stepId === 'consent');
    expect(consent?.figures.rates['step-share']).toEqual(rate(3, 3));
  });

  it('never lists the start as a transition between two steps', () => {
    const figures = funnelFigures(rows, 3);
    expect(figures.transitions).toEqual([
      { inquiryTemplateVersionId: 'itmplv_1', fromStepId: 'consent', toStepId: 'selfie', count: 2 },
    ]);
    expect(figures.entries).toEqual([
      { inquiryTemplateVersionId: 'itmplv_1', toStepId: 'consent', count: 3 },
    ]);
  });

  it('leaves the entry step without a step share where days lack the start (rolled up before it)', () => {
    const older = { ...rows, transitions: rows.transitions.slice(1) };
    const consent = funnelFigures(older, 3).steps.find((step) => step.stepId === 'consent');
    expect(consent?.figures.rates).not.toHaveProperty('step-share');
  });
});

describe('verificationFigures (C164.3, review H06)', () => {
  const attempts = people.flatMap((p) => p.attempts);
  const withAttempts = people.filter((p) => p.attempts.length > 0);
  const last = (p: Person) => p.attempts[p.attempts.length - 1]?.status;
  const status = (value: string) => attempts.filter((attempt) => attempt.status === value).length;

  it('counts attempts and per-person steps, each rate with its own unit', () => {
    const rows = verificationRows(people);
    const figures = verificationFigures(rows.attempts, rows.steps);
    expect(figures.counts).toEqual({
      created: attempts.length,
      submitted: attempts.filter((attempt) =>
        ['passed', 'failed', 'requires_retry', 'needs_review'].includes(attempt.status),
      ).length,
      passed: status('passed'),
      failed: status('failed'),
      'requires-retry': status('requires_retry'),
      skipped: status('skipped'),
      'needs-review': status('needs_review'),
      canceled: status('canceled'),
      'step-entered': withAttempts.length,
      'step-passed': withAttempts.filter((p) => last(p) === 'passed').length,
      'step-failed-after-attempts': withAttempts.filter(
        (p) => last(p) === 'failed' || last(p) === 'requires_retry',
      ).length,
      'step-needs-review': withAttempts.filter((p) => last(p) === 'needs_review').length,
      'step-skipped': withAttempts.filter((p) => last(p) === 'skipped').length,
    });
    expect(figures.rates).toEqual({
      'pass-rate-per-attempt': rate(
        status('passed'),
        status('passed') + status('failed') + status('requires_retry'),
      ),
      'pass-rate-per-person': rate(
        withAttempts.filter((p) => last(p) === 'passed').length,
        withAttempts.length,
      ),
    });
    expect(figures.histograms).toEqual({});
  });

  it('answers a group of its attempts alone when the caller passes one group', () => {
    const rows = verificationRows(people).attempts.filter((row) => row.captureMethod === 'camera');
    expect(verificationFigures(rows, []).counts.created).toBe(
      attempts.filter((attempt) => attempt.captureMethod === 'camera').length,
    );
  });
});

describe('checkFigures (C164.4, review H03)', () => {
  const results = (name: string) => people.flatMap((p) => p.checks.filter((c) => c.name === name));

  it('counts every status as its own column, the reasons and the failure share', () => {
    for (const name of CHECKS) {
      const rows = checkRows(people);
      const mine = results(name);
      const failedVerifications = 400;
      const figures = checkFigures(
        rows.results.filter((row) => row.checkName === name),
        rows.reasons.filter((row) => row.checkName === name),
        failedVerifications,
      );
      const of = (value: string) => mine.filter((check) => check.status === value).length;
      expect(figures.counts).toEqual({
        runs: mine.length,
        passed: of('passed'),
        failed: of('failed'),
        'not-applicable': of('not_applicable'),
        errored: of('errored'),
        'not-configured': of('not_configured'),
        pending: of('pending'),
        'failed-verifications': failedVerifications,
        ...Object.fromEntries(
          [...new Set(mine.flatMap((check) => check.reasons))]
            .sort()
            .map((reason) => [
              `reason:${reason}`,
              mine.reduce(
                (sum, check) => sum + check.reasons.filter((other) => other === reason).length,
                0,
              ),
            ]),
        ),
      });
      expect(figures.rates).toEqual({ 'failure-share': rate(of('failed'), failedVerifications) });
    }
  });

  it('shows a check that never ran as not run: no counts, never zero failures', () => {
    expect(checkFigures([], [], 10)).toEqual({ counts: {}, rates: {}, histograms: {} });
  });

  it('gives no failure share when the failed results outnumber the failed verifications', () => {
    const rows = checkRows(people).results.filter((row) => row.checkName === CHECKS[0]);
    expect(checkFigures(rows, [], 0).rates).toEqual({});
    expect(checkFigures(rows, [], 1).rates).toEqual({});
  });

  it('refuses rows of two checks, or a reason of another check', () => {
    const rows = checkRows(people);
    expect(() => checkFigures(rows.results, [], 10)).toThrow(RangeError);
    const mine = rows.results.filter((row) => row.checkName === CHECKS[0]);
    const other = rows.reasons.filter((row) => row.checkName === CHECKS[1]);
    expect(() => checkFigures(mine, other, 10)).toThrow(RangeError);
    expect(() => checkFigures(mine, [], -1)).toThrow(RangeError);
  });
});

describe('checkFigures: reasons of one type and requirement (K9-24, AL7)', () => {
  const key = {
    environmentId: 'env_1',
    day: '2026-03-28',
    timeZone: 'UTC',
    source: 'facts' as const,
    inquiryTemplateId: 'itmpl_1',
    inquiryTemplateVersionId: 'itmplv_1',
  };
  const result = {
    ...key,
    verificationType: 'government_id',
    checkName: 'name_match',
    requirement: 'required' as const,
    status: 'failed' as const,
    count: 2,
  };
  const reason = (
    requirement: 'required' | 'not_required',
    verificationType = 'government_id',
  ) => ({
    ...key,
    verificationType,
    checkName: 'name_match',
    requirement,
    reason: 'mismatch',
    count: 1,
  });

  it('refuses a reason of the check used another way', () => {
    expect(() => checkFigures([result], [reason('not_required')], 2)).toThrow(
      'check reasons are of the check, type and requirement of its results',
    );
    expect(() => checkFigures([result], [reason('required', 'selfie')], 2)).toThrow(
      'check reasons are of the check, type and requirement of its results',
    );
  });

  it('counts the reasons of the same use', () => {
    expect(checkFigures([result], [reason('required')], 2).counts['reason:mismatch']).toBe(1);
  });
});

describe('caseFigures and caseAssigneeFigures (C164.5, review P20)', () => {
  const { cases: caseRowsOf, assignees } = caseRows(cases);
  const counted = (predicate: (c: (typeof cases)[number]) => boolean) =>
    cases.filter(predicate).length;

  it('counts the cases and their resolution times, without the assignees unless passed', () => {
    const figures = caseFigures(caseRowsOf, null);
    expect(figures.counts).toEqual({
      created: cases.length,
      resolved: counted((c) => c.resolved),
      'sla-met': counted((c) => c.slaMet),
      'sla-missed': counted((c) => c.slaMissed),
    });
    expect(figures.histograms).toEqual({
      'resolution-time': histogramOf(cases.map((c) => c.resolutionSeconds)),
    });
    expect(caseFigures(caseRowsOf, assignees).counts.assigned).toBe(
      counted((c) => c.assignee !== null),
    );
  });

  it('gives each reviewer, and the former users together, their assigned and resolved cases', () => {
    const reviewers = caseAssigneeFigures(assignees);
    expect(reviewers.map((entry) => entry.userId)).toEqual([
      'usr_synthetic00000000000000001',
      'usr_synthetic00000000000000002',
    ]);
    for (const entry of reviewers) {
      expect(entry.figures.counts).toEqual({
        assigned: counted((c) => c.assignee === entry.userId),
        resolved: counted((c) => c.assignee === entry.userId && c.resolved),
      });
    }
    const [first] = assignees;
    if (first === undefined) {
      throw new Error('no row');
    }
    const former = caseAssigneeFigures([
      { ...first, userId: null },
      { ...first, userId: null, assigned: 2, resolved: 1 },
      first,
    ]);
    expect(former.map((entry) => entry.userId)).toEqual([first.userId, null]);
    expect(former[1]?.figures.counts).toEqual({
      assigned: first.assigned + 2,
      resolved: first.resolved + 1,
    });
  });
});

describe('signalFigures (C164.6)', () => {
  it('counts every fixed bin, zeros included, and null as not evaluated', () => {
    for (const name of [
      'inquiry/bot_score',
      'inquiry/tor_detected',
      'inquiry/max_session_distance',
    ]) {
      const entry = SIGNAL_BINS[name];
      const bins = entry?.kind === 'fixed' ? entry.bins : [];
      const figures = signalFigures(signalRows(people, name));
      expect(Object.keys(figures.counts), name).toEqual([...bins, 'not-evaluated']);
      expect(figures.counts['not-evaluated'], name).toBe(count((p) => p.signals[name] === null));
      expect(Object.values(figures.counts).reduce((sum, n) => sum + n, 0)).toBe(people.length);
    }
  });

  it('counts the session country by its codes in order, and refuses a bin a signal lacks', () => {
    const rows = signalRows(people, 'inquiry/country_from_session');
    const figures = signalFigures(rows);
    expect(Object.keys(figures.counts)).toEqual(['DE', 'FR', 'JP', 'not-evaluated']);
    expect(figures.counts.JP).toBe(
      count((p) => p.signals['inquiry/country_from_session'] === 'JP'),
    );
    const [row] = signalRows(people, 'inquiry/bot_score');
    if (row === undefined) {
      throw new Error('no row');
    }
    expect(() => signalFigures([{ ...row, bin: '101-110' }])).toThrow(RangeError);
    expect(() => signalFigures([...rows, row])).toThrow(RangeError);
    expect(signalFigures([])).toEqual({ counts: {}, rates: {}, histograms: {} });
  });
});

describe('the metric keys (C164.1-C164.6)', () => {
  it('answers only metric keys of its report, beside the bins and reasons named here', () => {
    const keys = (report: string) =>
      new Set(ANALYTICS_METRICS.filter((metric) => metric.report === report).map((m) => m.key));
    const inquiries = inquiryFigures(inquiryRows(people));
    for (const key of [...Object.keys(inquiries.counts), ...Object.keys(inquiries.rates)]) {
      expect(keys('inquiries').has(key), key).toBe(true);
    }
    expect(Object.keys(inquiries.histograms)).toEqual(['time-to-finish']);
  });
});
