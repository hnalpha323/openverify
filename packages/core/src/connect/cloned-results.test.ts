/**
 * C235.4 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 4): what a cloned result counts
 * for. Off by default: nothing counts and a cloned inquiry lands in review. On: a listed, passed
 * clone younger than `max-age-days` at the destination's decision counts; a cloned failure never
 * declines, it routes to review; a withdrawn destination consent stops the counting. Then a seeded
 * property: a count is only ever a fresh, listed, consented pass.
 */
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../analytics/testing/random.js';
import {
  CLONED_RESULT_IGNORE_REASONS,
  clonedInquiryOutcome,
  clonedResultVerdict,
  reliedOnCloned,
  type AcceptClonedResultsRule,
  type ClonedResultVerdict,
  type ClonedVerificationFacts,
} from './cloned-results.js';
import { VERIFICATION_TYPE_OF_SHARE_KIND } from './policy.js';

const DAY = 86_400_000;
const DECIDED_AT = new Date('2026-11-12T12:00:00.000Z');
const daysBefore = (days: number) => new Date(DECIDED_AT.getTime() - days * DAY);

const ACCEPT: AcceptClonedResultsRule = {
  'verification-types': ['government-id', 'database'],
  'max-age-days': 30,
};

const clone = (patch: Partial<ClonedVerificationFacts> = {}): ClonedVerificationFacts => ({
  type: 'government_id',
  status: 'passed',
  sourceDecidedAt: daysBefore(2),
  consentWithdrawnAt: null,
  ...patch,
});

describe('one cloned verification (C235.4)', () => {
  it.each([
    ['off: nothing counts', null, clone(), { use: 'ignore', reason: 'accept_cloned_results_off' }],
    [
      'off, left out',
      undefined,
      clone({ status: 'failed' }),
      { use: 'ignore', reason: 'accept_cloned_results_off' },
    ],
    ['a listed, fresh pass counts', ACCEPT, clone(), { use: 'count', reason: 'passed' }],
    [
      'a listed database pass counts',
      ACCEPT,
      clone({ type: 'database' }),
      { use: 'count', reason: 'passed' },
    ],
    [
      'a type the version does not list',
      ACCEPT,
      clone({ type: 'selfie' }),
      { use: 'ignore', reason: 'type_not_listed' },
    ],
    [
      'a type no share carries',
      ACCEPT,
      clone({ type: 'aamva' }),
      { use: 'ignore', reason: 'type_not_listed' },
    ],
    [
      'consent withdrawn before the decision',
      ACCEPT,
      clone({ consentWithdrawnAt: daysBefore(1) }),
      { use: 'ignore', reason: 'consent_withdrawn' },
    ],
    [
      'consent withdrawn at the decision',
      ACCEPT,
      clone({ consentWithdrawnAt: DECIDED_AT }),
      { use: 'ignore', reason: 'consent_withdrawn' },
    ],
    [
      'consent withdrawn after the decision',
      ACCEPT,
      clone({ consentWithdrawnAt: new Date(DECIDED_AT.getTime() + DAY) }),
      { use: 'count', reason: 'passed' },
    ],
    [
      '29 days old counts',
      ACCEPT,
      clone({ sourceDecidedAt: daysBefore(29) }),
      { use: 'count', reason: 'passed' },
    ],
    [
      'exactly 30 days old is too old',
      ACCEPT,
      clone({ sourceDecidedAt: daysBefore(30) }),
      { use: 'ignore', reason: 'too_old' },
    ],
    [
      'a source decision after the destination’s (clocks) counts',
      ACCEPT,
      clone({ sourceDecidedAt: new Date(DECIDED_AT.getTime() + 1000) }),
      { use: 'count', reason: 'passed' },
    ],
    [
      'a listed, fresh failure routes to review',
      ACCEPT,
      clone({ status: 'failed' }),
      { use: 'review', reason: 'cloned_failure' },
    ],
    [
      'a stale failure is ignored',
      ACCEPT,
      clone({ status: 'failed', sourceDecidedAt: daysBefore(31) }),
      { use: 'ignore', reason: 'too_old' },
    ],
    [
      'a failure under a withdrawn consent is ignored',
      ACCEPT,
      clone({ status: 'failed', consentWithdrawnAt: daysBefore(1) }),
      { use: 'ignore', reason: 'consent_withdrawn' },
    ],
    [
      'an undecided clone is ignored',
      ACCEPT,
      clone({ status: 'needs_review' }),
      { use: 'ignore', reason: 'not_decided' },
    ],
  ] as [
    string,
    AcceptClonedResultsRule | null | undefined,
    ClonedVerificationFacts,
    ClonedResultVerdict,
  ][])('%s', (_name, accept, facts, verdict) => {
    expect(clonedResultVerdict(accept, facts, DECIDED_AT)).toEqual(verdict);
  });
});

describe('a cloned inquiry (C235.4, C234.3)', () => {
  const count: ClonedResultVerdict = { use: 'count', reason: 'passed' };
  const ignore: ClonedResultVerdict = { use: 'ignore', reason: 'too_old' };
  const review: ClonedResultVerdict = { use: 'review', reason: 'cloned_failure' };

  it.each([
    [
      'off: review whatever the source decided',
      null,
      [count],
      'needs_review',
      'accept_cloned_results_off',
    ],
    ['off with no clone at all', undefined, [], 'needs_review', 'accept_cloned_results_off'],
    ['on with a cloned failure', ACCEPT, [count, review], 'needs_review', 'cloned_failure'],
    ['on with passes and ignored clones', ACCEPT, [count, ignore], 'destination_rules', undefined],
    ['on with nothing cloned', ACCEPT, [], 'destination_rules', undefined],
  ] as [
    string,
    AcceptClonedResultsRule | null | undefined,
    ClonedResultVerdict[],
    string,
    string | undefined,
  ][])('%s', (_name, accept, verdicts, status, reason) => {
    expect(clonedInquiryOutcome(accept, verdicts)).toEqual(
      reason === undefined ? { status } : { status, reason },
    );
  });

  it('relied on a cloned result exactly when one counted', () => {
    expect(reliedOnCloned([count])).toBe(true);
    expect(reliedOnCloned([ignore, count, review])).toBe(true);
    expect(reliedOnCloned([ignore, review])).toBe(false);
    expect(reliedOnCloned([])).toBe(false);
  });
});

describe('a count is only a fresh, listed, consented pass (property, seeded)', () => {
  it('holds over random settings and clones', () => {
    const random = seededRandom(235_4);
    const kinds = Object.keys(
      VERIFICATION_TYPE_OF_SHARE_KIND,
    ) as (keyof typeof VERIFICATION_TYPE_OF_SHARE_KIND)[];
    for (let run = 0; run < 3000; run += 1) {
      const accept: AcceptClonedResultsRule | null = random.chance(0.2)
        ? null
        : {
            'verification-types': kinds.filter(() => random.chance(0.5)),
            'max-age-days': random.int(1, 60),
          };
      const kind = random.pick(kinds);
      const facts = clone({
        type: VERIFICATION_TYPE_OF_SHARE_KIND[kind],
        status: random.pick(['passed', 'failed', 'needs_review', 'canceled']),
        sourceDecidedAt: daysBefore(random.int(-2, 90)),
        consentWithdrawnAt: random.chance(0.2) ? daysBefore(random.int(-5, 5)) : null,
      });
      const verdict = clonedResultVerdict(accept, facts, DECIDED_AT);
      const label = `run ${String(run)}`;
      if (verdict.use === 'ignore') {
        expect(CLONED_RESULT_IGNORE_REASONS, label).toContain(verdict.reason);
        continue;
      }
      expect(accept, label).not.toBeNull();
      expect(accept?.['verification-types'], label).toContain(kind);
      const age = DECIDED_AT.getTime() - facts.sourceDecidedAt.getTime();
      expect(age < (accept?.['max-age-days'] ?? 0) * DAY, label).toBe(true);
      expect(
        facts.consentWithdrawnAt === null ||
          facts.consentWithdrawnAt.getTime() > DECIDED_AT.getTime(),
        label,
      ).toBe(true);
      expect(facts.status, label).toBe(verdict.use === 'count' ? 'passed' : 'failed');
    }
  });
});
