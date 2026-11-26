/**
 * C75.8: one test per row of the match state machine (H17, V06, V07), in the plan's order, plus
 * the cases the table leaves to its precedence rule.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_MATCH_STATUSES,
  REPORT_REVIEW_STATUSES,
  decideMatchTransition,
  type MatchDecision,
  type MatchRowState,
  type ReportReviewStatus,
} from './report-match-state-machine.js';

const row = (
  status: MatchRowState['status'],
  reviewStatus: ReportReviewStatus = 'pending',
  notifyOnChange = false,
): MatchRowState => ({ status, reviewStatus, notifyOnChange });

const found = (evidence: 'same' | 'changed', riskData: 'same' | 'changed' = 'same') =>
  ({ type: 'found', evidence, riskData }) as const;

const NONE: Pick<MatchDecision, 'updateEvidence' | 'updateSnapshot' | 'setDelistedAt' | 'problem'> =
  { updateEvidence: false, updateSnapshot: false, setDelistedAt: false, problem: null };

describe('the match statuses (C73.2, C75.5)', () => {
  it('are open, dismissed and delisted, with the four public review statuses', () => {
    expect(REPORT_MATCH_STATUSES).toEqual(['open', 'dismissed', 'delisted']);
    expect(REPORT_REVIEW_STATUSES).toEqual([
      'pending',
      'indeterminate',
      'true_positive',
      'false_positive',
    ]);
  });
});

describe('decideMatchTransition (C75.8)', () => {
  it('row 1: no open or delisted row and a run finds the entry: a new open, pending match and .matched', () => {
    expect(decideMatchTransition(null, found('changed'))).toEqual({
      ...NONE,
      action: 'create',
      status: 'open',
      reviewStatus: 'pending',
      events: ['matched'],
      note: null,
      presentInLastRun: true,
    });
  });

  it('row 2: open, the same evidence and risk data: unchanged, present in the last run', () => {
    for (const review of REPORT_REVIEW_STATUSES.filter((status) => status !== 'false_positive')) {
      expect(decideMatchTransition(row('open', review, true), found('same'))).toEqual({
        ...NONE,
        action: 'unchanged',
        status: 'open',
        reviewStatus: review,
        events: [],
        note: null,
        presentInLastRun: true,
      });
    }
  });

  it('row 3: open, listed but not found above the minimum: stays open, not present, match_not_found_in_run', () => {
    expect(decideMatchTransition(row('open', 'true_positive'), { type: 'not_found' })).toEqual({
      ...NONE,
      action: 'update',
      status: 'open',
      reviewStatus: 'true_positive',
      events: [],
      note: 'match_not_found_in_run',
      presentInLastRun: false,
    });
  });

  it('row 4: open and pending, a changed evidence hash: updated in place, evidence_changed, no event', () => {
    expect(decideMatchTransition(row('open', 'pending', true), found('changed'))).toEqual({
      ...NONE,
      action: 'update',
      status: 'open',
      reviewStatus: 'pending',
      events: [],
      note: 'evidence_changed',
      presentInLastRun: true,
      updateEvidence: true,
    });
  });

  it('row 5: open and reviewed, a changed evidence hash: in place; back to pending and .matched only with notify-on-change', () => {
    for (const review of ['indeterminate', 'true_positive'] as const) {
      expect(decideMatchTransition(row('open', review, true), found('changed'))).toEqual({
        ...NONE,
        action: 'update',
        status: 'open',
        reviewStatus: 'pending',
        events: ['matched'],
        note: 'evidence_changed',
        presentInLastRun: true,
        updateEvidence: true,
      });
      expect(decideMatchTransition(row('open', review, false), found('changed'))).toEqual({
        ...NONE,
        action: 'update',
        status: 'open',
        reviewStatus: review,
        events: [],
        note: 'evidence_changed',
        presentInLastRun: true,
        updateEvidence: true,
      });
    }
  });

  it('row 6: open, the evidence reverted to content dismissed before: updated in place and never dismissed by the run', () => {
    // The run applies to the open row (precedence), so the dismissed row's hash plays no part.
    const decision = decideMatchTransition(row('open', 'true_positive', false), found('changed'));
    expect(decision).toMatchObject({ action: 'update', status: 'open', updateEvidence: true });
    expect(decision.events).not.toContain('dismissed');
  });

  it('row 7: open and pending, the same evidence and changed risk data: snapshot updated, risk_data_changed, no event', () => {
    expect(decideMatchTransition(row('open', 'pending', true), found('same', 'changed'))).toEqual({
      ...NONE,
      action: 'update',
      status: 'open',
      reviewStatus: 'pending',
      events: [],
      note: 'risk_data_changed',
      presentInLastRun: true,
      updateSnapshot: true,
    });
  });

  it('row 8: open and reviewed, changed risk data: snapshot updated; back to pending and .matched only with notify-on-change (V06)', () => {
    for (const review of ['indeterminate', 'true_positive'] as const) {
      expect(
        decideMatchTransition(row('open', review, true), found('same', 'changed')),
      ).toMatchObject({
        action: 'update',
        reviewStatus: 'pending',
        events: ['matched'],
        note: 'risk_data_changed',
        updateSnapshot: true,
        updateEvidence: false,
      });
      expect(
        decideMatchTransition(row('open', review, false), found('same', 'changed')),
      ).toMatchObject({
        action: 'update',
        reviewStatus: review,
        events: [],
        note: 'risk_data_changed',
        updateSnapshot: true,
      });
    }
  });

  it('row 9: open, a dismissal or a false_positive review: dismissed and .dismissed (and .reviewed for the review)', () => {
    expect(decideMatchTransition(row('open', 'indeterminate'), { type: 'dismiss' })).toEqual({
      ...NONE,
      action: 'update',
      status: 'dismissed',
      reviewStatus: 'false_positive',
      events: ['dismissed'],
      note: null,
      presentInLastRun: null,
    });
    for (const reviewType of ['record', 'all_records'] as const) {
      expect(
        decideMatchTransition(row('open'), {
          type: 'review',
          reviewType,
          reviewStatus: 'false_positive',
        }),
      ).toEqual({
        ...NONE,
        action: 'update',
        status: 'dismissed',
        reviewStatus: 'false_positive',
        events: ['reviewed', 'dismissed'],
        note: null,
        presentInLastRun: null,
      });
    }
  });

  it('row 10: open, any other review: the review set, open, .reviewed', () => {
    for (const reviewStatus of ['pending', 'indeterminate', 'true_positive'] as const) {
      expect(
        decideMatchTransition(row('open', 'pending'), {
          type: 'review',
          reviewType: 'all_records',
          reviewStatus,
        }),
      ).toEqual({
        ...NONE,
        action: 'update',
        status: 'open',
        reviewStatus,
        events: ['reviewed'],
        note: null,
        presentInLastRun: null,
      });
    }
  });

  it('row 11: dismissed, the same evidence whatever the risk data: suppressed, never lapsed', () => {
    for (const riskData of ['same', 'changed'] as const) {
      expect(
        decideMatchTransition(row('dismissed', 'false_positive'), found('same', riskData)),
      ).toEqual({
        ...NONE,
        action: 'suppress',
        status: 'dismissed',
        reviewStatus: 'false_positive',
        events: [],
        note: null,
        presentInLastRun: true,
      });
    }
  });

  it('row 12: dismissed, a changed evidence hash: lapses into a new open, pending match and .matched', () => {
    expect(decideMatchTransition(row('dismissed', 'false_positive'), found('changed'))).toEqual({
      ...NONE,
      action: 'lapse',
      status: 'open',
      reviewStatus: 'pending',
      events: ['matched'],
      note: null,
      presentInLastRun: true,
    });
  });

  it('row 13: dismissed, a record review other than false_positive, no current row: re-opened with it and .reviewed', () => {
    for (const reviewStatus of ['pending', 'indeterminate', 'true_positive'] as const) {
      expect(
        decideMatchTransition(row('dismissed', 'false_positive'), {
          type: 'review',
          reviewType: 'record',
          reviewStatus,
          entryHasCurrentRow: false,
        }),
      ).toEqual({
        ...NONE,
        action: 'reopen',
        status: 'open',
        reviewStatus,
        events: ['reviewed'],
        note: null,
        presentInLastRun: null,
      });
    }
  });

  it('row 14: dismissed, the same review while the entry has an open or delisted row: 409 report_match_superseded, nothing changes', () => {
    expect(
      decideMatchTransition(row('dismissed', 'false_positive'), {
        type: 'review',
        reviewType: 'record',
        reviewStatus: 'true_positive',
        entryHasCurrentRow: true,
      }),
    ).toEqual({
      ...NONE,
      action: 'refuse',
      status: null,
      reviewStatus: null,
      events: [],
      note: null,
      presentInLastRun: null,
      problem: 'report_match_superseded',
    });
  });

  it('row 15: open, its entry removed from the source: delisted, delisted_at set, never dismissed', () => {
    expect(decideMatchTransition(row('open', 'true_positive'), { type: 'removed' })).toEqual({
      ...NONE,
      action: 'update',
      status: 'delisted',
      reviewStatus: 'true_positive',
      events: [],
      note: null,
      presentInLastRun: false,
      setDelistedAt: true,
    });
  });

  it('row 16: dismissed, its entry removed: stays dismissed, delisted_at set', () => {
    expect(decideMatchTransition(row('dismissed', 'false_positive'), { type: 'removed' })).toEqual({
      ...NONE,
      action: 'update',
      status: 'dismissed',
      reviewStatus: 'false_positive',
      events: [],
      note: null,
      presentInLastRun: false,
      setDelistedAt: true,
    });
  });

  it('row 17: delisted, the entry listed again: open with its earlier review and .matched', () => {
    expect(decideMatchTransition(row('delisted', 'true_positive'), found('changed'))).toEqual({
      ...NONE,
      action: 'update',
      status: 'open',
      reviewStatus: 'true_positive',
      events: ['matched'],
      note: null,
      presentInLastRun: true,
      updateEvidence: true,
    });
  });

  it('row 18: delisted, a record review: recorded, stays delisted, .reviewed', () => {
    expect(
      decideMatchTransition(row('delisted', 'pending'), {
        type: 'review',
        reviewType: 'record',
        reviewStatus: 'true_positive',
      }),
    ).toEqual({
      ...NONE,
      action: 'update',
      status: 'delisted',
      reviewStatus: 'true_positive',
      events: ['reviewed'],
      note: null,
      presentInLastRun: null,
    });
  });
});

describe('decideMatchTransition: cases the table leaves to its rules (C75.8)', () => {
  it('applies an all_records review and a dismissal to open matches only', () => {
    for (const status of ['dismissed', 'delisted'] as const) {
      expect(
        decideMatchTransition(row(status, 'false_positive'), {
          type: 'review',
          reviewType: 'all_records',
          reviewStatus: 'true_positive',
        }).action,
      ).toBe('not_applicable');
      expect(decideMatchTransition(row(status, 'false_positive'), { type: 'dismiss' }).action).toBe(
        'not_applicable',
      );
    }
  });

  it('keeps a dismissed match dismissed on a false_positive record review, recording it (.reviewed only)', () => {
    expect(
      decideMatchTransition(row('dismissed', 'false_positive'), {
        type: 'review',
        reviewType: 'record',
        reviewStatus: 'false_positive',
      }),
    ).toMatchObject({
      action: 'update',
      status: 'dismissed',
      reviewStatus: 'false_positive',
      events: ['reviewed'],
    });
  });

  it('never closes a match a run stops finding, and leaves dismissed and delisted rows alone', () => {
    expect(
      decideMatchTransition(row('dismissed', 'false_positive'), { type: 'not_found' }),
    ).toMatchObject({ action: 'unchanged', status: 'dismissed', presentInLastRun: false });
    expect(decideMatchTransition(row('delisted'), { type: 'not_found' })).toMatchObject({
      action: 'unchanged',
      status: 'delisted',
    });
    expect(decideMatchTransition(row('delisted'), { type: 'removed' })).toMatchObject({
      action: 'unchanged',
      status: 'delisted',
    });
  });

  it('has nothing to do for an entry without any row unless a run found it', () => {
    for (const event of [
      { type: 'not_found' },
      { type: 'removed' },
      { type: 'dismiss' },
      { type: 'review', reviewType: 'record', reviewStatus: 'true_positive' },
    ] as const) {
      expect(decideMatchTransition(null, event)).toMatchObject({
        action: 'not_applicable',
        status: null,
        reviewStatus: null,
        events: [],
      });
    }
  });
});
