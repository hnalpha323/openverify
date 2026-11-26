/**
 * The match review state machine (plan C75.8; H17, V06, V07). A run, a reviewer or the list
 * itself acts on one match row of a report's list entry; {@link decideMatchTransition} says what
 * happens, as a table with one row per case, so the API applies it and never decides on its own.
 *
 * Which row a run's finding is applied to (C75.8): the entry's `open` or `delisted` row when there
 * is one; otherwise its newest `dismissed` row; otherwise none (`null`). A match is closed only by
 * a person or by its entry leaving the source, never by a run that stops finding it.
 */
import { z } from 'zod';
import type { ReportRunNote } from './report-state-machine.js';

/** C73.2: a match row's status; `has-match` is "some match is `open`" (C70.2). */
export const REPORT_MATCH_STATUSES = ['open', 'dismissed', 'delisted'] as const;
export const reportMatchStatusSchema = z.enum(REPORT_MATCH_STATUSES);
export type ReportMatchStatus = z.infer<typeof reportMatchStatusSchema>;

/** C75.5: the screening review statuses of the public schema. */
export const REPORT_REVIEW_STATUSES = [
  'pending',
  'indeterminate',
  'true_positive',
  'false_positive',
] as const;
export const reportReviewStatusSchema = z.enum(REPORT_REVIEW_STATUSES);
export type ReportReviewStatus = z.infer<typeof reportReviewStatusSchema>;

/** C75.5: whether a true positive bears on the decision. */
export const REPORT_RISK_LEVELS = ['material', 'immaterial'] as const;
export const reportRiskLevelSchema = z.enum(REPORT_RISK_LEVELS);
export type ReportRiskLevel = z.infer<typeof reportRiskLevelSchema>;

/** C75.5: one match (`record`, with its token) or every open match (`all_records`). */
export const REPORT_REVIEW_TYPES = ['all_records', 'record'] as const;
export const reportReviewTypeSchema = z.enum(REPORT_REVIEW_TYPES);
export type ReportReviewType = z.infer<typeof reportReviewTypeSchema>;

/** C75.2: a media dismissal targets one article (`media`) or every article (`entity`). */
export const REPORT_DISMISS_TYPES = ['entity', 'media'] as const;
export const reportDismissTypeSchema = z.enum(REPORT_DISMISS_TYPES);
export type ReportDismissType = z.infer<typeof reportDismissTypeSchema>;

/** The parts of a match row the machine reads. */
export interface MatchRowState {
  readonly status: ReportMatchStatus;
  readonly reviewStatus: ReportReviewStatus;
  readonly notifyOnChange: boolean;
}

/** How a run's finding of the entry compares with the row's stored evidence and risk data. */
export type EvidenceComparison = 'same' | 'changed';

export type MatchEvent =
  /** The run found the entry above the preset's minimum (for a `delisted` row: listed again). */
  | {
      readonly type: 'found';
      /** The evidence hash (C75.3) against the row's. */
      readonly evidence: EvidenceComparison;
      /** The risk-data hash (C77.3) against the row's snapshot. */
      readonly riskData: EvidenceComparison;
    }
  /** The entry is still listed, but this run did not find it above the minimum. */
  | { readonly type: 'not_found' }
  /** The entry left its source. */
  | { readonly type: 'removed' }
  /** `POST /dismiss` targeting the row. */
  | { readonly type: 'dismiss' }
  /** `POST /review`. */
  | {
      readonly type: 'review';
      readonly reviewType: ReportReviewType;
      readonly reviewStatus: ReportReviewStatus;
      /** For a `record` review of a `dismissed` row: the entry already has an `open` or `delisted` row. */
      readonly entryHasCurrentRow?: boolean;
    };

/** What the API does with the row (or, for `create` and `lapse`, with a new row). */
export type MatchAction =
  'create' | 'lapse' | 'unchanged' | 'update' | 'suppress' | 'reopen' | 'refuse' | 'not_applicable';

/** The events a transition fires, in order. */
export type MatchEventAction = 'matched' | 'dismissed' | 'reviewed';

export interface MatchDecision {
  readonly action: MatchAction;
  /** The status of the row afterwards (the new row's for `create` and `lapse`); `null` when refused. */
  readonly status: ReportMatchStatus | null;
  /** The review status of the row afterwards; `null` when refused. */
  readonly reviewStatus: ReportReviewStatus | null;
  readonly events: readonly MatchEventAction[];
  /** The note the run records (C73.2), if any. */
  readonly note: ReportRunNote | null;
  /** `present_in_last_run` afterwards, when the event is a run's; `null` otherwise. */
  readonly presentInLastRun: boolean | null;
  /** Replace the row's evidence hash and snapshot with the run's (in place, no second row). */
  readonly updateEvidence: boolean;
  /** Replace the row's snapshot only (a risk-data change). */
  readonly updateSnapshot: boolean;
  /** Set `delisted_at`. */
  readonly setDelistedAt: boolean;
  /** The problem a refused review answers with. */
  readonly problem: 'report_match_superseded' | null;
}

const QUIET = {
  updateEvidence: false,
  updateSnapshot: false,
  setDelistedAt: false,
  problem: null,
} as const;

/** A decision with the defaults of a transition that touches nothing else. */
function decision(
  fields: Pick<MatchDecision, 'action' | 'status' | 'reviewStatus'> & Partial<MatchDecision>,
): MatchDecision {
  return { ...QUIET, events: [], note: null, presentInLastRun: null, ...fields };
}

const NOT_APPLICABLE = decision({ action: 'not_applicable', status: null, reviewStatus: null });

/** Whether a reviewed match goes back to `pending` (and alerts) when its data changes (V06). */
function reAlerts(row: MatchRowState): boolean {
  return row.reviewStatus !== 'pending' && row.notifyOnChange;
}

/** Rows 2-8: a run finds the entry of an `open` match. */
function foundOpen(row: MatchRowState, evidence: EvidenceComparison, riskData: EvidenceComparison) {
  const same = { status: 'open', presentInLastRun: true } as const;
  if (evidence === 'changed') {
    // Rows 4, 5 and 6: in place, never a second row and never a dismissal.
    return decision({
      ...same,
      action: 'update',
      reviewStatus: reAlerts(row) ? 'pending' : row.reviewStatus,
      events: reAlerts(row) ? ['matched'] : [],
      note: 'evidence_changed',
      updateEvidence: true,
    });
  }
  if (riskData === 'changed') {
    // Rows 7 and 8: a new programme or position (V06).
    return decision({
      ...same,
      action: 'update',
      reviewStatus: reAlerts(row) ? 'pending' : row.reviewStatus,
      events: reAlerts(row) ? ['matched'] : [],
      note: 'risk_data_changed',
      updateSnapshot: true,
    });
  }
  return decision({ ...same, action: 'unchanged', reviewStatus: row.reviewStatus });
}

/** Rows 9, 10, 13, 14 and 18: a review of the row. */
function reviewed(row: MatchRowState, event: Extract<MatchEvent, { type: 'review' }>) {
  const falsePositive = event.reviewStatus === 'false_positive';
  if (row.status === 'open') {
    return falsePositive
      ? decision({
          action: 'update',
          status: 'dismissed',
          reviewStatus: 'false_positive',
          events: ['reviewed', 'dismissed'],
        })
      : decision({
          action: 'update',
          status: 'open',
          reviewStatus: event.reviewStatus,
          events: ['reviewed'],
        });
  }
  // `all_records` applies to open matches only (C75.5).
  if (event.reviewType === 'all_records') {
    return NOT_APPLICABLE;
  }
  if (row.status === 'delisted') {
    return decision({
      action: 'update',
      status: 'delisted',
      reviewStatus: event.reviewStatus,
      events: ['reviewed'],
    });
  }
  if (falsePositive) {
    // Already dismissed: the review is recorded and nothing is dismissed again.
    return decision({
      action: 'update',
      status: 'dismissed',
      reviewStatus: 'false_positive',
      events: ['reviewed'],
    });
  }
  if (event.entryHasCurrentRow === true) {
    return decision({
      action: 'refuse',
      status: null,
      reviewStatus: null,
      problem: 'report_match_superseded',
    });
  }
  return decision({
    action: 'reopen',
    status: 'open',
    reviewStatus: event.reviewStatus,
    events: ['reviewed'],
  });
}

/** C75.8: the transition of `row` (or of no row) on `event`. */
export function decideMatchTransition(row: MatchRowState | null, event: MatchEvent): MatchDecision {
  if (row === null) {
    // Row 1: a new open, pending match; nothing else concerns an entry without a row.
    return event.type === 'found'
      ? decision({
          action: 'create',
          status: 'open',
          reviewStatus: 'pending',
          events: ['matched'],
          presentInLastRun: true,
        })
      : NOT_APPLICABLE;
  }
  const kept = { status: row.status, reviewStatus: row.reviewStatus } as const;
  switch (event.type) {
    case 'found':
      if (row.status === 'open') {
        return foundOpen(row, event.evidence, event.riskData);
      }
      if (row.status === 'delisted') {
        // Row 17: listed again, with its earlier review.
        return decision({
          ...kept,
          action: 'update',
          status: 'open',
          events: ['matched'],
          presentInLastRun: true,
          updateEvidence: true,
        });
      }
      // Rows 11 and 12: a dismissal holds while the identity is the same, whatever the risk data.
      return event.evidence === 'same'
        ? decision({ ...kept, action: 'suppress', presentInLastRun: true })
        : decision({
            action: 'lapse',
            status: 'open',
            reviewStatus: 'pending',
            events: ['matched'],
            presentInLastRun: true,
          });
    case 'not_found':
      // Row 3: an open match a run no longer finds stays open; a person closes it.
      return row.status === 'open'
        ? decision({
            ...kept,
            action: 'update',
            note: 'match_not_found_in_run',
            presentInLastRun: false,
          })
        : decision({ ...kept, action: 'unchanged', presentInLastRun: false });
    case 'removed':
      // Rows 15 and 16: delisted, never dismissed; a dismissed match keeps its dismissal.
      if (row.status === 'delisted') {
        return decision({ ...kept, action: 'unchanged' });
      }
      return decision({
        ...kept,
        action: 'update',
        status: row.status === 'open' ? 'delisted' : 'dismissed',
        presentInLastRun: false,
        setDelistedAt: true,
      });
    case 'dismiss':
      // Row 9: only open matches are dismissed (C75.2).
      return row.status === 'open'
        ? decision({
            action: 'update',
            status: 'dismissed',
            reviewStatus: 'false_positive',
            events: ['dismissed'],
          })
        : NOT_APPLICABLE;
    case 'review':
      return reviewed(row, event);
  }
}
