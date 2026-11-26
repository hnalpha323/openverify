/**
 * C90.5, C99.4 (Workflow 7B, `api-lists`; V06, H02): `inquiry/list_match_count`, merged when served
 * from the screening row, so the two jobs never write one column: each of its states, its place
 * last in `signals`, its own `computed-at`, the setting that hides it, and an answer while the
 * stored signals are still `null`. No state reads "no match" unless a screening completed.
 */
import { signalAttributeIssues, signalDetailsSchema } from '@openverify/contracts';
import type { Inquiry, ListScreening } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { CONSOLE_SIGNAL_VIEW, servedInquirySignals } from './served.js';

const NAME = 'inquiry/list_match_count';
const COMPUTED = '2026-10-30T00:00:00.000Z';
const CREATED = new Date('2026-10-30T01:00:00.000Z');
const SCREENED = new Date('2026-10-30T02:00:00.000Z');
const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const OPEN = { exposeSignals: true };

const computed: Pick<Inquiry, 'signals' | 'signalDetails'> = {
  signals: [{ name: 'inquiry/session_count', value: 1 }],
  signalDetails: {
    'computed-at': COMPUTED,
    'inquiry/session_count': {
      tier: 'R',
      stage: 'ga',
      version: 1,
      'null-reason': null,
      reasons: [],
      'computed-at': COMPUTED,
    },
  },
};
const uncomputed: Pick<Inquiry, 'signals' | 'signalDetails'> = {
  signals: null,
  signalDetails: null,
};

const row = (overrides: Partial<ListScreening> = {}): ListScreening => ({
  status: 'pending',
  matchCount: null,
  unscreened: [],
  notApplicable: [],
  reviewCause: null,
  screenedAt: null,
  createdAt: CREATED,
  ...overrides,
});

function expectValid(served: ReturnType<typeof servedInquirySignals>) {
  const details = signalDetailsSchema.parse(served.signalDetails);
  expect(signalAttributeIssues(served.signals, details)).toEqual([]);
}

const entry = (served: ReturnType<typeof servedInquirySignals>) =>
  served.signalDetails[NAME];

describe('inquiry/list_match_count when served (C99.4)', () => {
  it('reads a completed screening’s count, last in registry order, at its own time', () => {
    const served = servedInquirySignals(
      {
        inquiry: computed,
        listScreening: row({
          status: 'completed',
          matchCount: 2,
          screenedAt: SCREENED,
          notApplicable: [{ 'list-id': LIST, reason: 'subject_has_no_value' }],
          reviewCause: 'list_match',
        }),
      },
      OPEN,
    );

    expect(served.signals).toEqual([
      { name: 'inquiry/session_count', value: 1 },
      { name: NAME, value: 2 },
    ]);
    expect(entry(served)).toEqual({
      tier: 'R',
      stage: 'ga',
      version: 1,
      'null-reason': null,
      reasons: [],
      'computed-at': SCREENED.toISOString(),
      'list-screening': {
        status: 'completed',
        unscreened: [],
        'not-applicable': [{ 'list-id': LIST, reason: 'subject_has_no_value' }],
        'review-cause': 'list_match',
      },
    });
    expect(served.signalDetails['computed-at']).toBe(COMPUTED);
    expectValid(served);
  });

  it.each(['partial', 'errored'] as const)('reads a %s screening as null, listing why', (status) => {
    const unscreened = [{ 'list-id': LIST, reason: 'normaliser_outdated' }];
    const served = servedInquirySignals(
      {
        inquiry: computed,
        listScreening: row({ status, screenedAt: SCREENED, unscreened }),
      },
      OPEN,
    );

    expect(served.signals.at(-1)).toEqual({ name: NAME, value: null });
    expect(entry(served)).toMatchObject({
      'null-reason': 'list_unscreened',
      'list-screening': { status, unscreened },
    });
    expectValid(served);
  });

  it('reads an unfinished screening as pending', () => {
    const served = servedInquirySignals({ inquiry: computed, listScreening: row() }, OPEN);

    expect(served.signals.at(-1)).toEqual({ name: NAME, value: null });
    expect(entry(served)).toMatchObject({
      'null-reason': 'list_screening_pending',
      'computed-at': CREATED.toISOString(),
      'list-screening': { status: 'pending' },
    });
    expectValid(served);
  });

  it('reads no row as no list selected, once the signals exist', () => {
    const served = servedInquirySignals({ inquiry: computed, listScreening: null }, OPEN);

    expect(served.signals.at(-1)).toEqual({ name: NAME, value: null });
    expect(entry(served)).toMatchObject({
      'null-reason': 'no_lists_selected',
      'computed-at': COMPUTED,
    });
    expect(entry(served)).not.toHaveProperty('list-screening');
    expectValid(served);
  });

  it('still answers while the stored signals are null', () => {
    const served = servedInquirySignals(
      {
        inquiry: uncomputed,
        listScreening: row({ status: 'completed', matchCount: 1, screenedAt: SCREENED }),
      },
      OPEN,
    );

    expect(served.signals).toEqual([{ name: NAME, value: 1 }]);
    expect(served.signalDetails['computed-at']).toBeNull();
    expectValid(served);
  });

  it('serves nothing before either job ran, so "not yet" stays "not yet"', () => {
    expect(servedInquirySignals({ inquiry: uncomputed, listScreening: null }, OPEN)).toEqual({
      signals: [],
      signalDetails: { 'computed-at': null },
    });
  });

  it('serves nothing with expose-signals off, like the rest (C90.8)', () => {
    const listScreening = row({ status: 'completed', matchCount: 1, screenedAt: SCREENED });
    expect(
      servedInquirySignals({ inquiry: computed, listScreening }, { exposeSignals: false }),
    ).toEqual({ signals: [], signalDetails: { 'computed-at': COMPUTED } });
    expect(
      servedInquirySignals({ inquiry: uncomputed, listScreening }, { exposeSignals: false }),
    ).toEqual({ signals: [], signalDetails: { 'computed-at': null } });
  });

  it('shows the console the count whatever the setting says', () => {
    const served = servedInquirySignals(
      {
        inquiry: computed,
        listScreening: row({ status: 'completed', matchCount: 3, screenedAt: SCREENED }),
      },
      CONSOLE_SIGNAL_VIEW,
    );
    expect(served.signals.at(-1)).toEqual({ name: NAME, value: 3 });
  });
});
