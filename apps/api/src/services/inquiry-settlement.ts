/**
 * C7, C30.5, C50.5: settling an inquiry once its verifications allow it. Moved out of the
 * `process-verification` job (C54.1) so every path that decides or skips a verification settles
 * the inquiry the same way.
 *
 * A `pending` inquiry moves to `completed` or `failed` when `decideInquiryOutcome` says so,
 * publishing `inquiry.completed` or `inquiry.failed`; with a verification under review it moves to
 * `completed` then `needs_review` in one transaction, so `inquiry.completed` precedes
 * `inquiry.marked-for-review` (C30.5). Each AAMVA attempt the server created is judged as bound to
 * the government ID verification it copied (`verification_inputs.source_verification_id`, C59.6).
 * A failed inquiry loses its face data in the same
 * transaction (C42.2). The conditional status update lets only one of two concurrent settlements
 * move it; settling is idempotent.
 *
 * C151.3 (Workflow 9A): an inquiry the server flow engine positioned settles by `flowOutcome` over
 * its step record (`settle` of `flow-engine/engine.ts`), the same rules the engine applies when its
 * position reaches a terminal step; an inquiry it never positioned keeps the rules above.
 *
 * A redacted pending inquiry is never settled (owner decision 5 after Workflow 6C): the update
 * refuses to complete or fail it, also when the redaction commits while the settlement waits for
 * the row, so nothing is published and it stays `pending` until the expiry sweep expires it. This
 * amends Phase 3's G002, where the inquiry was then settled as usual.
 */
import { loadEngine, settle } from '../flow-engine/engine.js';
import { requiredVerificationsForInquiry } from '../flow-engine/required.js';
import type { InquiryStatus } from '@openverify/core';
import {
  deleteFaceDataForInquiry,
  getInquiry,
  listInquiryVerifications,
  listVerificationInputSources,
  type Db,
} from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { decideInquiryOutcome, isRetryableFailure } from '../jobs/inquiry-outcome.js';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock } from '../ports.js';
import { transitionInquiryInTx } from './inquiries.js';
import { countedVerifications } from './connect/cloned-results.js';

/** What settling needs: the database, the events, the clock and a logger. */
export interface InquirySettlementDeps {
  db: Db;
  events: TransactionalEventPublisher;
  clock: Clock;
  logger: WorkerLogger;
}

/**
 * Moves a pending inquiry to `completed` or `failed` when its verifications allow it, and
 * publishes the events. Returns the inquiry's status afterwards.
 * @param flow the flow of the inquiry's pinned template version.
 */
export async function settleInquiry(
  deps: InquirySettlementDeps,
  environmentId: string,
  inquiryId: string,
  flow: Flow,
): Promise<InquiryStatus> {
  const { db, events } = deps;
  const settled = await db.transaction(
    async (tx): Promise<{ status: InquiryStatus; staged: StagedEvent[] }> => {
      const inquiry = await getInquiry(tx, environmentId, inquiryId);
      if (inquiry?.status !== 'pending') {
        return { status: inquiry?.status ?? 'pending', staged: [] };
      }
      // C151.3 (Workflow 9A): an inquiry the flow engine positioned is decided by the path taken
      // (`flowOutcome`), never by its verifications alone: it completes only once the position
      // reaches a completion step, whatever its verifications say meanwhile.
      if (inquiry.flowStepId !== null) {
        const engine = await loadEngine(tx, deps, { environmentId, inquiryId });
        if (engine !== null) {
          await settle(engine);
          return { status: engine.inquiry.status, staged: engine.staged };
        }
      }
      // C235.4, C235.7 (Workflow 11A Stage 1b (R), `foundation-11a`'s hook): a clone that does not
      // count is absent from the decision (`api-redeem`'s cloned-results.ts).
      const verifications = await countedVerifications(
        tx,
        inquiry,
        await listInquiryVerifications(tx, environmentId, inquiryId),
        deps.clock.now(),
      );
      // C59.6: a server-created AAMVA attempt is bound to the government ID it copied.
      const sources = await listVerificationInputSources(
        tx,
        environmentId,
        verifications.filter((verification) => verification.type === 'aamva').map(({ id }) => id),
      );
      const outcome = decideInquiryOutcome(
        // C151.3 (Workflow 9A Stage 1b (S)): the verifications on the path taken (`api-flow-engine`).
        await requiredVerificationsForInquiry(tx, inquiry, flow),
        verifications.map((verification) => ({
          id: verification.id,
          type: verification.type,
          status: verification.status,
          retryable: isRetryableFailure(verification.checks),
          sourceVerificationId: sources.get(verification.id) ?? null,
        })),
      );
      if (outcome === null) {
        return { status: inquiry.status, staged: [] };
      }
      // C30.5: an inquiry with a verification under review completes, then goes to review, in
      // this transaction, so inquiry.completed precedes inquiry.marked-for-review.
      const moved = await transitionInquiryInTx(
        tx,
        deps,
        inquiry,
        outcome === 'failed' ? 'failed' : 'completed',
      );
      if (moved === null) {
        // Another job moved the inquiry first and published the events.
        const current = await getInquiry(tx, environmentId, inquiryId);
        return { status: current?.status ?? outcome, staged: [] };
      }
      if (outcome === 'failed') {
        // C42.2: a failed inquiry loses its face templates and background rows in this transaction.
        await deleteFaceDataForInquiry(tx, environmentId, inquiryId);
      }
      if (outcome !== 'needs_review') {
        return { status: moved.inquiry.status, staged: moved.staged };
      }
      const reviewed = await transitionInquiryInTx(tx, deps, moved.inquiry, 'needs_review');
      if (reviewed === null) {
        // The row is locked by the first update until this transaction ends.
        throw new Error('settleInquiry: the completed inquiry changed within its transaction');
      }
      return { status: reviewed.inquiry.status, staged: [...moved.staged, ...reviewed.staged] };
    },
  );
  await events.dispatch(settled.staged);
  if (settled.staged.length > 0) {
    deps.logger.info({ inquiryId, status: settled.status }, 'inquiry decided');
  }
  return settled.status;
}
