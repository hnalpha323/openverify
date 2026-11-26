/**
 * C128.6 (V22): while human review is pending on a reopened inquiry, a decline by a run or an API key
 * answers `human_review_pending`. A user's decline passes, and closes the review (`record.ts`).
 * Mark-for-review and an approve under C127.1 stay allowed, because neither takes the decision from
 * the person.
 */
import type { AuditActor } from '@openverify/contracts';
import { findPendingHumanReview, type Db } from '@openverify/db';
import { WorkflowProblemError } from '../../errors.js';

export interface InquiryDecisionGuardInput {
  environmentId: string;
  inquiryId: string;
  actor: AuditActor;
}

/** @throws {WorkflowProblemError} 409 `human_review_pending`, for a run or an API key. */
export async function inquiryDecisionGuardInTx(
  tx: Db,
  { environmentId, inquiryId, actor }: InquiryDecisionGuardInput,
): Promise<void> {
  if (actor.type === 'user') {
    return;
  }
  if ((await findPendingHumanReview(tx, environmentId, inquiryId)) !== null) {
    throw new WorkflowProblemError(
      'human_review_pending',
      `Inquiry ${inquiryId} waits for a person: only a user can decline it now.`,
    );
  }
}
