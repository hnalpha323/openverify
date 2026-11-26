/**
 * C101.4, C102.7 (Workflow 7B; P04): the redaction hooks. `RedactionService` calls them in the
 * redaction's own transaction:
 *
 * - {@link redactInquiryGraphInTx} in `redactInquiry`: the rows the inquiry contributed (by
 *   `graph_attributes.inquiry_id`) are deleted, and the inquiry's account leaves every stored
 *   result with its links;
 * - {@link redactAccountGraphInTx} in `redactAccount`: every row of the account and its component
 *   are deleted, and the account leaves every stored result with its links.
 *
 * A scrubbed result's stored copies are forgotten (`forgetStoredResponses`) and its events stubbed.
 * Both run again on a re-run, for anything written in between. Owner: `api-graph`; `foundation-7b`
 * (Stage 1b (G)) froze the signatures.
 */
import {
  deleteAccountGraphAttributes,
  deleteGraphComponent,
  deleteInquiryGraphAttributes,
  forgetStoredResponses,
  getInquiry,
  scrubAccountFromGraphQueries,
  stubEventPayloads,
  type Db,
} from '@openverify/db';

export interface GraphRedactionOutcome {
  deletedRows: number;
  /** The stored results the account left. */
  scrubbedQueries: number;
}

export type RedactInquiryGraphInTx = (
  tx: Db,
  target: { environmentId: string; inquiryId: string; at: Date },
) => Promise<GraphRedactionOutcome>;

export type RedactAccountGraphInTx = (
  tx: Db,
  target: { environmentId: string; accountId: string; at: Date },
) => Promise<GraphRedactionOutcome>;

/** Takes the account out of every stored result; stubs and forgets what those results said. */
async function scrub(tx: Db, environmentId: string, accountId: string, at: Date): Promise<number> {
  const queries = await scrubAccountFromGraphQueries(tx, environmentId, accountId);
  if (queries.length > 0) {
    await stubEventPayloads(tx, environmentId, queries, at);
    await forgetStoredResponses(tx, environmentId, queries);
  }
  return queries.length;
}

export const redactInquiryGraphInTx: RedactInquiryGraphInTx = async (tx, target) => {
  const { environmentId, inquiryId, at } = target;
  const deletedRows = await deleteInquiryGraphAttributes(tx, environmentId, inquiryId);
  const inquiry = await getInquiry(tx, environmentId, inquiryId);
  const scrubbedQueries =
    inquiry === null ? 0 : await scrub(tx, environmentId, inquiry.accountId, at);
  return { deletedRows, scrubbedQueries };
};

export const redactAccountGraphInTx: RedactAccountGraphInTx = async (tx, target) => {
  const { environmentId, accountId, at } = target;
  const deletedRows = await deleteAccountGraphAttributes(tx, environmentId, accountId);
  await deleteGraphComponent(tx, environmentId, accountId);
  return { deletedRows, scrubbedQueries: await scrub(tx, environmentId, accountId, at) };
};
