/**
 * C128.3, C121.3: what a stopped decision leaves. An inquiry is marked for review; a transaction, a
 * list item or an account gets the error in its decision record with `needs-review: true`, shown in
 * the console's review list. A redacted inquiry stays as it is (outcome 6).
 */
import { canTransitionInquiry, type DecisionSubjectType } from '@openverify/core';
import { createInquiryDecision, type Db } from '@openverify/db';
import { deleteObjects } from '../../../services/selfie-captures.js';
import { applyInquiryAction, lockedInquiry } from '../../../services/inquiries.js';
import type { RunDecisionFacts } from '../../../services/decisions/record.js';
import type { ActionContext, ActionFollowUp } from '../../engine/action-port.js';
import { apiDepsOf } from '../shared.js';

/** The inquiry to review, when it can still move there. */
export async function markInquiryForReviewInTx(
  tx: Db,
  context: ActionContext,
  inquiryId: string,
  facts: RunDecisionFacts,
  errorCode: string,
): Promise<ActionFollowUp> {
  const deps = apiDepsOf(context);
  const inquiry = await lockedInquiry(tx, context.environmentId, inquiryId);
  if (inquiry.redactedAt !== null || !canTransitionInquiry(inquiry.status, 'needs_review')) {
    return {};
  }
  const { staged, storageKeys } = await applyInquiryAction(
    tx,
    deps,
    context.acting,
    inquiry,
    'needs_review',
    { decision: { run: { ...facts, evidence: [], pendingEvidence: [] }, errorCode } },
  );
  return {
    staged,
    afterCommit: async () => {
      await deleteObjects(deps.storage, storageKeys);
    },
  };
}

export interface AdverseRecord {
  kind?: 'adverse';
  subjectType: DecisionSubjectType;
  subjectId: string;
  facts: RunDecisionFacts;
  comment?: string | undefined;
  needsReview?: boolean;
  errorCode?: string | null;
}

/** C128.1: the record of an adverse step on a subject that is no inquiry. */
export async function recordAdverseDecisionInTx(
  tx: Db,
  context: ActionContext,
  record: AdverseRecord,
): Promise<string> {
  const id = context.services.ids.newId('idec');
  await createInquiryDecision(tx, context.environmentId, {
    ...record.facts,
    id,
    kind: 'adverse',
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    actorType: 'workflow-run',
    actorId: context.runId,
    comment: record.comment ?? null,
    needsReview: record.needsReview ?? false,
    errorCode: record.errorCode ?? null,
  });
  return id;
}
