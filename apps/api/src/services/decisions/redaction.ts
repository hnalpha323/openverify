/**
 * C128.1 (P35, V25): redacting a subject (an inquiry, an account, a transaction or a list item) keeps
 * its decision records, the accountability record of Art. 5(2) and 22, and nulls their comments.
 */
import { redactDecisionComments, type Db } from '@openverify/db';

export interface DecisionRedactionInput {
  environmentId: string;
  /** The redacted subjects' ids. */
  subjectIds: readonly string[];
  at: Date;
}

export async function redactDecisionCommentsInTx(
  tx: Db,
  { environmentId, subjectIds }: DecisionRedactionInput,
): Promise<void> {
  await redactDecisionComments(tx, environmentId, subjectIds);
}
