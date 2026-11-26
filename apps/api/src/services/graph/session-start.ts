/**
 * C101.3 (Workflow 7B; P05): the session start's call of the indexer, at the call site 7A reserved
 * in `recordSessionStart`, after `recordSessionDeviceInTx`, in the start's transaction.
 *
 * - `evaluateSessionNetworkInTx` can write nothing and answer `null` (an address that does not
 *   parse, a session already evaluated, an evaluation that failed): that reads as no address, and
 *   nothing is indexed.
 * - The indexer runs in a savepoint and its failure is logged by name and goes no further, so it
 *   never rolls the session's start back: a missed IP row is a gap in a weak kind, never a failed
 *   flow call. The session's device HMACs are indexed by the `graph-index` job at the inquiry's end.
 *
 * Built by `foundation-7b` (Stage 1b (G)); `api-graph` owns the file from Stage 3.
 */
import { getInquiry, type Db, type InquirySession } from '@openverify/db';
import type { WorkerLogger } from '../../jobs/logger.js';
import { indexAccountAttributesInTx } from './indexing.js';

export type IndexSessionAddressInTx = (
  tx: Db,
  session: Pick<InquirySession, 'id' | 'environmentId' | 'inquiryId'>,
  network: { networkId: string } | null,
  client: { ip: string },
  logger: Pick<WorkerLogger, 'warn'>,
) => Promise<number>;

/** Returns how many rows the indexer wrote; 0 without an address or after a failure. */
export const indexSessionAddressInTx: IndexSessionAddressInTx = async (
  tx,
  session,
  network,
  client,
  logger,
) => {
  if (network === null) {
    return 0;
  }
  try {
    return await tx.transaction(async (savepoint) => {
      const inquiry = await getInquiry(savepoint, session.environmentId, session.inquiryId);
      if (inquiry === null) {
        return 0;
      }
      return indexAccountAttributesInTx(
        savepoint,
        session.environmentId,
        inquiry.accountId,
        { type: 'inquiry-session', id: session.id, inquiryId: session.inquiryId },
        { kind: 'session-address', ip: client.ip, networkId: network.networkId },
      );
    });
  } catch (error) {
    logger.warn({ error: (error as Error).name }, 'session address not indexed');
    return 0;
  }
};
