/**
 * C96.3 (Workflow 7A; P15, V02): a rejected handoff routes the inquiry to `needs_review` with the
 * cause `handoff_rejected` when it completes. `transitionInquiryInTx` asks
 * {@link handoffReviewAfterTransitionInTx} after every move it applied, in its transaction; an
 * answer of `needs_review` on a move into `completed` follows it with `completed → needs_review`
 * in the same transaction. Owner: `flow-handoff`; the signature is frozen by `foundation-7a`
 * (Stage 1b (H)).
 *
 * The cause is recorded as a system audit entry, `handoff.review-requested`, on the inquiry
 * (`{ cause: 'handoff_rejected' }`): no principal acted. A rejection of an inquiry already
 * `completed` moves it itself (`flow-handoffs.ts`).
 */
import {
  hasRejectedHandoffVerifications,
  type Db,
  type Inquiry,
  type InquiryStatus,
} from '@openverify/db';
import { appendSystemAuditEntry } from '../audit-log.js';

export interface HandoffTransition {
  /** The inquiry after the move. */
  inquiry: Inquiry;
  from: InquiryStatus;
  to: InquiryStatus;
}

/** The audit entry that records why a rejected handoff sent the inquiry to review. */
export const HANDOFF_REVIEW_AUDIT_ACTION = 'handoff.review-requested';

export async function handoffReviewAfterTransitionInTx(
  tx: Db,
  transition: HandoffTransition,
): Promise<'needs_review' | null> {
  const { inquiry, to } = transition;
  if (to !== 'completed') {
    return null;
  }
  if (!(await hasRejectedHandoffVerifications(tx, inquiry.environmentId, inquiry.id))) {
    return null;
  }
  await appendSystemAuditEntry(tx, inquiry.environmentId, {
    action: HANDOFF_REVIEW_AUDIT_ACTION,
    resourceType: 'inquiry',
    resourceId: inquiry.id,
    metadata: { cause: 'handoff_rejected' },
  });
  return 'needs_review';
}
