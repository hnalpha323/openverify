/**
 * C127.7 (V27): who last moved a transaction's status, served as its `reviewer`. `foundation-8a`
 * placed the call in the Phase 7 status service, so the API path sets the user or key, and
 * `update_transaction_status` the run.
 */
import type { AuditActor } from '@openverify/contracts';
import { setTransactionReviewer, type Db } from '@openverify/db';

export interface TransactionReviewerInput {
  environmentId: string;
  transactionId: string;
  actor: AuditActor;
}

export async function setTransactionReviewerInTx(
  tx: Db,
  { environmentId, transactionId, actor }: TransactionReviewerInput,
): Promise<void> {
  await setTransactionReviewer(tx, environmentId, transactionId, actor);
}
