/**
 * C152.4, C152.8 (Workflow 9A; review P13, V08): the accounts a flow's `update_account_fields`
 * actions copied to, read from the inquiry's action rows. The inquiry's redaction
 * (`services/redaction.ts`, a call `foundation-9a` (Stage 1b (S)) placed) reads them into its result
 * and audit entry before `redactInquiryRecords` deletes the rows. Owner: `api-flow-actions`.
 *
 * Keys and ids only: the values copied live on the account, whose own redaction removes them; the
 * docs say an inquiry's redaction names those accounts and leaves their fields as they are.
 */
import { listInquiryFlowActionCopies, type Db } from '@openverify/db';

/** One account copy: the target account and the field keys written, never their values. */
export interface FlowActionCopyTarget {
  accountId: string;
  keys: readonly string[];
  stepId: string;
  entry: number;
}

/** The copy targets of the inquiry's flow actions, read in `tx` before its rows are deleted. */
export async function flowActionCopyTargets(
  tx: Db,
  inquiry: { environmentId: string; inquiryId: string },
): Promise<FlowActionCopyTarget[]> {
  const copies = await listInquiryFlowActionCopies(tx, inquiry.environmentId, inquiry.inquiryId);
  return copies.map(({ targetAccountId, copiedKeys, stepId, entry }) => ({
    accountId: targetAccountId,
    keys: [...copiedKeys],
    stepId,
    entry,
  }));
}
