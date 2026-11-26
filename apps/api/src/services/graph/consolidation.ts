/**
 * C101.4 (Workflow 7B): the consolidation hook. `consolidateAccounts` (`services/accounts.ts`) calls
 * {@link moveGraphOnConsolidationInTx} in its transaction, under its account locks (in id order),
 * after the inquiries moved: the absorbed accounts' `graph_attributes` rows move to the survivor,
 * one row per value and source kept, and their components go.
 *
 * Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signature. The absorbed accounts'
 * components are left to the next nightly run, as every account newer than it is.
 */
import { moveAccountGraphAttributes, type Db } from '@openverify/db';

export interface GraphConsolidation {
  environmentId: string;
  targetId: string;
  sourceIds: readonly string[];
}

export type MoveGraphOnConsolidationInTx = (tx: Db, move: GraphConsolidation) => Promise<number>;

/** Returns how many rows moved. */
export const moveGraphOnConsolidationInTx: MoveGraphOnConsolidationInTx = (tx, move) =>
  moveAccountGraphAttributes(tx, move.environmentId, {
    targetId: move.targetId,
    sourceIds: move.sourceIds,
  });
