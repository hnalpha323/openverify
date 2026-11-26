/**
 * C128.1 (Workflow 8A): the decision record. Owner: `api-actions`. `comment` is sealed to the row
 * (`SEALED.inquiryDecisionComment`).
 *
 * Redacting a subject keeps every code, id, basis and flag and nulls the comment alone (P35, V25).
 */
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealOptional } from '../sealed.js';
import {
  graphIndexJobs,
  inquiryDecisions,
  inquirySignalComputations,
  listScreenings,
  reports,
  type DecisionEvidence,
  type DecisionFlowFacts,
  type DecisionHumanStep,
  type DecisionPendingEvidence,
  type DecisionRunFacts,
  type InquiryDecisionRow,
} from '../schema.js';
import { environmentCursor, paginate, type Page, type PageRequest } from './pagination.js';

/** A decision as the repositories return it, its comment opened. */
export interface InquiryDecision extends Omit<InquiryDecisionRow, 'commentSealed'> {
  comment: string | null;
}

export interface NewInquiryDecision {
  id: string;
  kind: InquiryDecisionRow['kind'];
  subjectType: InquiryDecisionRow['subjectType'];
  subjectId: string;
  actorType: InquiryDecisionRow['actorType'];
  actorId: string;
  run?: DecisionRunFacts | null;
  /** C150.7: a flow failure's path (`api-flow-actions`); `null` on every other record. */
  flow?: DecisionFlowFacts | null;
  solelyAutomated?: boolean | null;
  humanStep?: DecisionHumanStep | null;
  evidence?: readonly DecisionEvidence[];
  pendingEvidence?: readonly DecisionPendingEvidence[];
  decisionBasis?: InquiryDecisionRow['decisionBasis'];
  contestRoute?: Record<string, unknown> | null;
  biometricBasis?: InquiryDecisionRow['biometricBasis'];
  comment?: string | null;
  needsReview?: boolean;
  humanReviewPending?: boolean;
  errorCode?: string | null;
  testRunId?: string | null;
  /** C235.4 (Workflow 11A): the decision relied on a counted Connect clone; `false` by default. */
  reliedOnCloned?: boolean;
  /** C235.4: the share token of the counted clone, required when `reliedOnCloned`. */
  shareTokenId?: string | null;
}

function opened({ commentSealed, ...row }: InquiryDecisionRow): InquiryDecision {
  return {
    ...row,
    comment: openOptional(SEALED.inquiryDecisionComment, row.id, commentSealed),
  };
}

const newestFirst = [desc(inquiryDecisions.createdAt), desc(inquiryDecisions.id)];

export async function createInquiryDecision(
  tx: Db,
  environmentId: string,
  input: NewInquiryDecision,
): Promise<InquiryDecision> {
  const [row] = await tx
    .insert(inquiryDecisions)
    .values({
      id: input.id,
      environmentId,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      actorType: input.actorType,
      actorId: input.actorId,
      run: input.run ?? null,
      flow: input.flow ?? null,
      solelyAutomated: input.solelyAutomated ?? null,
      humanStep: input.humanStep ?? null,
      evidence: [...(input.evidence ?? [])],
      pendingEvidence: [...(input.pendingEvidence ?? [])],
      decisionBasis: input.decisionBasis ?? null,
      contestRoute: input.contestRoute ?? null,
      biometricBasis: input.biometricBasis ?? null,
      commentSealed: sealOptional(SEALED.inquiryDecisionComment, input.id, input.comment),
      needsReview: input.needsReview ?? false,
      humanReviewPending: input.humanReviewPending ?? false,
      errorCode: input.errorCode ?? null,
      testRunId: input.testRunId ?? null,
      // C235.4 (Workflow 11A, api-redeem): a decision that relied on a counted Connect clone.
      reliedOnCloned: input.reliedOnCloned ?? false,
      shareTokenId: input.shareTokenId ?? null,
    })
    .returning();
  if (row === undefined) {
    throw new Error('a decision wrote no row');
  }
  return opened(row);
}

export async function getInquiryDecision(
  db: Db,
  environmentId: string,
  id: string,
): Promise<InquiryDecision | null> {
  const [row] = await db
    .select()
    .from(inquiryDecisions)
    .where(and(eq(inquiryDecisions.environmentId, environmentId), eq(inquiryDecisions.id, id)))
    .limit(1);
  return row === undefined ? null : opened(row);
}

/** `GET /decisions?filter[subject-id]=`: `created_at DESC, id DESC`. */
export async function listInquiryDecisions(
  db: Db,
  environmentId: string,
  subjectId: string,
  page: PageRequest,
): Promise<Page<InquiryDecision>> {
  const found = await paginate(
    db,
    environmentCursor(inquiryDecisions),
    environmentId,
    page,
    (after, limit) =>
      db
        .select()
        .from(inquiryDecisions)
        .where(
          and(
            eq(inquiryDecisions.environmentId, environmentId),
            eq(inquiryDecisions.subjectId, subjectId),
            after,
          ),
        )
        .orderBy(...newestFirst)
        .limit(limit),
  );
  return { items: found.items.map(opened), next: found.next };
}

/** Every decision of `subjectIds`, for the `decisions` include, newest first. */
export async function listDecisionsForSubjects(
  db: Db,
  environmentId: string,
  subjectIds: readonly string[],
): Promise<InquiryDecision[]> {
  if (subjectIds.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(inquiryDecisions)
    .where(
      and(
        eq(inquiryDecisions.environmentId, environmentId),
        inArray(inquiryDecisions.subjectId, [...subjectIds]),
      ),
    )
    .orderBy(...newestFirst);
  return rows.map(opened);
}

/** C128.6: the `reopen` row whose human review is open, if any. */
export async function findPendingHumanReview(
  db: Db,
  environmentId: string,
  subjectId: string,
): Promise<InquiryDecision | null> {
  const [row] = await db
    .select()
    .from(inquiryDecisions)
    .where(
      and(
        eq(inquiryDecisions.environmentId, environmentId),
        eq(inquiryDecisions.subjectId, subjectId),
        eq(inquiryDecisions.humanReviewPending, true),
      ),
    )
    .limit(1);
  return row === undefined ? null : opened(row);
}

/** C128.6: a user decided, so the review is closed. */
export async function closePendingHumanReview(
  tx: Db,
  environmentId: string,
  subjectId: string,
): Promise<void> {
  await tx
    .update(inquiryDecisions)
    .set({ humanReviewPending: false, updatedAt: sql`now()` })
    .where(
      and(
        eq(inquiryDecisions.environmentId, environmentId),
        eq(inquiryDecisions.subjectId, subjectId),
        eq(inquiryDecisions.humanReviewPending, true),
      ),
    );
}

/** C128.1 (V25): nulls the comments of `subjectIds` and nothing else. Answers how many changed. */
export async function redactDecisionComments(
  tx: Db,
  environmentId: string,
  subjectIds: readonly string[],
): Promise<number> {
  if (subjectIds.length === 0) {
    return 0;
  }
  const rows = await tx
    .update(inquiryDecisions)
    .set({ commentSealed: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(inquiryDecisions.environmentId, environmentId),
        inArray(inquiryDecisions.subjectId, [...subjectIds]),
        isNotNull(inquiryDecisions.commentSealed),
      ),
    )
    .returning({ id: inquiryDecisions.id });
  return rows.length;
}

/**
 * C128.1 (H13): what is still pending for an inquiry at a decision: its reports, its list screening,
 * its graph indexing and its signals, by id or name, never a value.
 */
export async function listPendingDecisionEvidence(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<DecisionPendingEvidence[]> {
  const pendingReports = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.environmentId, environmentId),
        eq(reports.inquiryId, inquiryId),
        eq(reports.status, 'pending'),
      ),
    )
    .orderBy(asc(reports.id));
  const pendingBy = async (
    table: typeof listScreenings | typeof graphIndexJobs | typeof inquirySignalComputations,
    column: SQL,
  ): Promise<boolean> => {
    const rows = await db
      .select({ inquiryId: table.inquiryId })
      .from(table)
      .where(and(eq(table.environmentId, environmentId), eq(table.inquiryId, inquiryId), column))
      .limit(1);
    return rows.length > 0;
  };
  const pending: DecisionPendingEvidence[] = pendingReports.map(({ id }) => ({
    kind: 'report',
    id,
    name: null,
  }));
  if (await pendingBy(listScreenings, eq(listScreenings.status, 'pending'))) {
    pending.push({ kind: 'list-screening', id: null, name: 'list_screening' });
  }
  if (await pendingBy(graphIndexJobs, eq(graphIndexJobs.status, 'pending'))) {
    pending.push({ kind: 'graph-index', id: null, name: 'graph_index' });
  }
  if (await pendingBy(inquirySignalComputations, eq(inquirySignalComputations.state, 'pending'))) {
    pending.push({ kind: 'signal', id: null, name: 'signal_computation' });
  }
  return pending;
}
