/**
 * C75 (Workflow 6A Stage 3, `api-reports`): dismissal and review of a report's matches
 * (`POST /reports/:id/dismiss`, `POST /reports/:id/review`, `reports:review`), one engine for
 * every type with review. Each runs in one transaction under the report's row lock (C73.7: the
 * report, then its matches), decides every row with the C75.8 state machine
 * (`decideMatchTransition`), writes an action with its sealed details and an audit entry with
 * counts, and stages `.reviewed` (with `payload.meta` per C70.4) and `.dismissed` (with the match
 * ids) in the transaction, dispatched after commit.
 *
 * - A dismissal closes the open matches (all of them, those of one entry, or one article with
 *   `dismiss-type: media`) into the ignore list: `dismissed`, `false_positive`, with who, why and
 *   when in the sealed snapshot. Suppression on later runs is the framework's (`persist.ts`).
 * - A review sets the review fields of one `record` or of every open match (`all_records`); a
 *   `false_positive` dismisses; a `record` review of a dismissed match re-opens it unless its entry
 *   already has a newer open or delisted row (409 `report_match_superseded`); a delisted match
 *   keeps its status.
 * - Refusals: 409 `report_not_reviewable` for a type without review, a pending report or an
 *   errored one without a match row (an errored report that kept matches is reviewable and stays
 *   `errored`); 410 `report_redacted`; 404 `report_match_not_found`.
 * - `pause-on-match`: a report paused on a match resumes after `resume-delay-minutes` once no open
 *   match is unreviewed (C74.5).
 *
 * The reason and the comment are PII: they reach only the sealed snapshot and action details,
 * never a log, an audit entry, a problem or an event.
 */
import {
  resolveReportTemplateConfig,
  type DismissReportBody,
  type ReportResource,
  type ReviewReportBody,
} from '@openverify/contracts';
import {
  decideMatchTransition,
  REPORT_REGISTRY,
  reportEventName,
  type MatchDecision,
} from '@openverify/core';
import {
  getReportTemplateVersion,
  insertReportAction,
  listReportMatches,
  updateReportMatch,
  updateReportState,
  type Db,
  type StoredReport,
  type StoredReportMatch,
} from '@openverify/db';
import { UNMASKED } from '../../auth/pii.js';
import { ReportProblemError } from '../../errors.js';
import type { StagedEvent } from '../../events/index.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';
import {
  actionActor,
  assertNotRedacted,
  findStoredReport,
  reportResourceOf,
  reportViewOf,
} from './reports.js';
import { reportResource } from './resources.js';

type DismissAttributes = DismissReportBody['data']['attributes'];
type ReviewAttributes = ReviewReportBody['data']['attributes'];

const MEDIA = new Set(['adverse-media', 'business-adverse-media']);

/** C75.6: the refusals both routes share. */
function assertReviewable(report: StoredReport, matches: readonly StoredReportMatch[]): void {
  assertNotRedacted(report);
  if (REPORT_REGISTRY[report.reportType].review !== 'matches') {
    throw new ReportProblemError(
      'report_not_reviewable',
      `A ${report.reportType} report has no matches to review.`,
    );
  }
  if (report.status === 'pending' || (report.status === 'errored' && matches.length === 0)) {
    throw new ReportProblemError(
      'report_not_reviewable',
      'The report has no screening result to review yet.',
    );
  }
}

const entryKeyOf = (match: StoredReportMatch): string | null => {
  const key = match.snapshot?.['entry-key'];
  return typeof key === 'string' ? key : null;
};

/** The dismissal's targets (C75.2): the open matches it names. */
function dismissTargets(
  report: StoredReport,
  matches: readonly StoredReportMatch[],
  attributes: DismissAttributes,
): StoredReportMatch[] {
  const open = matches.filter((match) => match.status === 'open');
  const entityId = attributes['entity-id'];
  const everyArticle = MEDIA.has(report.reportType) && attributes['dismiss-type'] === 'entity';
  const targets =
    entityId === undefined || everyArticle
      ? open
      : open.filter((match) => entryKeyOf(match) === entityId);
  if (targets.length === 0) {
    throw new ReportProblemError(
      'report_match_not_found',
      entityId === undefined
        ? 'The report has no open match to dismiss.'
        : 'No open match of the report has that entity id.',
    );
  }
  return targets;
}

/** One row's decided change. */
interface Decided {
  match: StoredReportMatch;
  decision: MatchDecision;
}

/** What writing the decisions needs from the action. */
interface Applied {
  at: Date;
  actorId: string;
  /** The reason a dismissal records (the dismissal's reason, or a false positive's comment). */
  reason: string | null;
  review?: Pick<ReviewAttributes, 'risk-level' | 'notify-on-change'>;
}

/** Writes each row's decision; returns the ids it dismissed. */
async function applyDecisions(
  tx: Db,
  environmentId: string,
  decided: readonly Decided[],
  applied: Applied,
): Promise<string[]> {
  const dismissed: string[] = [];
  for (const { match, decision } of decided) {
    const status = decision.status ?? match.status;
    const snapshot = { ...match.snapshot };
    if (status === 'dismissed' && match.status !== 'dismissed') {
      snapshot.dismissal = {
        user: applied.actorId,
        reason: applied.reason,
        at: applied.at.toISOString(),
      };
      dismissed.push(match.id);
    } else if (status !== 'dismissed') {
      delete snapshot.dismissal;
    }
    await updateReportMatch(tx, environmentId, match.id, {
      status,
      reviewStatus: decision.reviewStatus ?? match.reviewStatus,
      reviewedAt: applied.at,
      snapshot,
      ...(applied.review?.['risk-level'] === undefined
        ? {}
        : { riskLevel: applied.review['risk-level'] }),
      ...(applied.review?.['notify-on-change'] === undefined
        ? {}
        : { notifyOnChange: applied.review['notify-on-change'] }),
      at: applied.at,
    });
  }
  return dismissed;
}

/**
 * The report's `has-match` after the change, and the C74.5 resume of a report paused on a match
 * once no open match is left unreviewed.
 */
async function settleReport(tx: Db, report: StoredReport, now: Date): Promise<void> {
  const matches = await listReportMatches(tx, report.environmentId, report.id);
  const open = matches.filter((match) => match.status === 'open');
  const hasMatch = open.length > 0;
  let schedule = {};
  if (report.pausedReason === 'match' && !open.some((m) => m.reviewStatus === 'pending')) {
    const version = await getReportTemplateVersion(
      tx,
      report.environmentId,
      report.reportTemplateVersionId,
    );
    const config =
      version === null ? {} : resolveReportTemplateConfig(report.reportType, version.config);
    const delay =
      typeof config['resume-delay-minutes'] === 'number' ? config['resume-delay-minutes'] : 0;
    schedule = {
      pausedAt: null,
      pausedReason: null,
      nextRunAt: new Date(now.getTime() + delay * 60_000),
    };
  }
  await updateReportState(tx, report.environmentId, report.id, { hasMatch, ...schedule });
}

/** Stages the action's events with the report as it is now. */
async function stageEvents(
  tx: Db,
  deps: ApiDependencies,
  report: StoredReport,
  events: readonly {
    action: 'reviewed' | 'dismissed';
    meta: Record<string, unknown>;
  }[],
): Promise<StagedEvent[]> {
  const current = await findStoredReport(tx, report.environmentId, report.id);
  const data = reportResource(await reportViewOf(tx, current), UNMASKED);
  const staged: StagedEvent[] = [];
  for (const event of events) {
    staged.push(
      await deps.events.stage(tx, {
        environmentId: report.environmentId,
        name: reportEventName(report.reportType, event.action),
        payload: { data, meta: event.meta },
      }),
    );
  }
  return staged;
}

/** `POST /reports/:id/dismiss` (C75.2). */
export async function dismissReportMatches(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  attributes: DismissAttributes,
): Promise<ReportResource> {
  const { db, clock, ids } = deps;
  const { environmentId } = acting.ctx;
  const now = clock.now();
  const actor = actionActor(acting);
  const { report, staged } = await db.transaction(async (tx) => {
    const current = await findStoredReport(tx, environmentId, id, 'update');
    const matches = await listReportMatches(tx, environmentId, id);
    assertReviewable(current, matches);
    const decided = dismissTargets(current, matches, attributes).map((match) => ({
      match,
      decision: decideMatchTransition(match, { type: 'dismiss' }),
    }));
    const dismissed = await applyDecisions(tx, environmentId, decided, {
      at: now,
      actorId: actor.actorId,
      reason: attributes.reason,
    });
    await settleReport(tx, current, now);
    await insertReportAction(tx, environmentId, {
      id: ids.newId('ract'),
      reportId: id,
      actionType: 'dismiss',
      ...actor,
      details: { reason: attributes.reason, matchIds: dismissed },
      createdAt: now,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'report.dismissed',
        resourceType: 'report',
        resourceId: id,
        metadata: { matches: dismissed.length },
      }),
    );
    const events = await stageEvents(tx, deps, current, [
      { action: 'dismissed', meta: { 'match-ids': dismissed } },
    ]);
    return { report: await findStoredReport(tx, environmentId, id), staged: events };
  });
  await deps.events.dispatch(staged);
  return reportResourceOf(db, report, acting.mask);
}

/** The review's rows (C75.5): one record, or every open match. */
function reviewTargets(
  matches: readonly StoredReportMatch[],
  attributes: ReviewAttributes,
): Decided[] {
  if (attributes['review-type'] === 'all_records') {
    const open = matches.filter((match) => match.status === 'open');
    if (open.length === 0) {
      throw new ReportProblemError('report_match_not_found', 'The report has no open match.');
    }
    return open.map((match) => ({
      match,
      decision: decideMatchTransition(match, {
        type: 'review',
        reviewType: 'all_records',
        reviewStatus: attributes['review-status'],
      }),
    }));
  }
  const match = matches.find((candidate) => candidate.id === attributes['record-token']);
  if (match === undefined) {
    throw new ReportProblemError('report_match_not_found', 'The report holds no such match.');
  }
  const entryHasCurrentRow =
    match.status === 'dismissed' &&
    match.entryIndex !== null &&
    matches.some(
      (other) =>
        other.id !== match.id &&
        other.entryIndex === match.entryIndex &&
        (other.status === 'open' || other.status === 'delisted'),
    );
  const decision = decideMatchTransition(match, {
    type: 'review',
    reviewType: 'record',
    reviewStatus: attributes['review-status'],
    entryHasCurrentRow,
  });
  if (decision.action === 'refuse') {
    throw new ReportProblemError(
      'report_match_superseded',
      'A newer match of the same entry replaced this one; review that match.',
    );
  }
  return [{ match, decision }];
}

/** `POST /reports/:id/review` (C75.5). */
export async function reviewReportMatches(
  deps: ApiDependencies,
  acting: Acting,
  id: string,
  attributes: ReviewAttributes,
): Promise<ReportResource> {
  const { db, clock, ids } = deps;
  const { environmentId } = acting.ctx;
  const now = clock.now();
  const actor = actionActor(acting);
  const { report, staged } = await db.transaction(async (tx) => {
    const current = await findStoredReport(tx, environmentId, id, 'update');
    const matches = await listReportMatches(tx, environmentId, id);
    assertReviewable(current, matches);
    const decided = reviewTargets(matches, attributes);
    const comment = attributes.comment ?? null;
    const dismissed = await applyDecisions(tx, environmentId, decided, {
      at: now,
      actorId: actor.actorId,
      reason: comment,
      review: attributes,
    });
    await settleReport(tx, current, now);
    const reviewedIds = decided.map(({ match }) => match.id);
    await insertReportAction(tx, environmentId, {
      id: ids.newId('ract'),
      reportId: id,
      actionType: 'review',
      ...actor,
      details: {
        comment,
        matchIds: reviewedIds,
        reviewStatus: attributes['review-status'],
        riskLevel: attributes['risk-level'] ?? null,
      },
      createdAt: now,
    });
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'report.reviewed',
        resourceType: 'report',
        resourceId: id,
        metadata: {
          reviewType: attributes['review-type'],
          reviewStatus: attributes['review-status'],
          matches: reviewedIds.length,
        },
      }),
    );
    const events = await stageEvents(tx, deps, current, [
      {
        action: 'reviewed',
        meta: {
          'review-type': attributes['review-type'],
          'review-status': attributes['review-status'],
          'risk-level': attributes['risk-level'] ?? null,
          'record-token': attributes['record-token'] ?? null,
          reviewer: actor.actorId,
        },
      },
      ...(dismissed.length > 0
        ? [{ action: 'dismissed' as const, meta: { 'match-ids': dismissed } }]
        : []),
    ]);
    return { report: await findStoredReport(tx, environmentId, id), staged: events };
  });
  await deps.events.dispatch(staged);
  return reportResourceOf(db, report, acting.mask);
}
