/**
 * C84.4: the report side of account consolidation. `consolidateAccounts` (`services/accounts.ts`)
 * calls {@link moveReportLinksInTx} in its transaction, after it locked the accounts in id order and
 * moved their inquiries: the absorbed accounts' report links (`report_accounts`, and a home
 * `account_id`) move to the absorbing account, deduplicated.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3); the signature is frozen by `foundation-6`
 * (Stage 1b). The caller holds the accounts (C73.7), so no report lock is needed: a report's
 * links change only here, at creation and at a completion report's initial run, each under the
 * account lock order.
 */
import { moveReportAccountLinks, type Db } from '@openverify/db';

export interface ReportLinksMove {
  environmentId: string;
  /** The absorbing account. */
  targetId: string;
  /** The absorbed accounts. */
  sourceIds: readonly string[];
}

export type MoveReportLinksInTx = (tx: Db, move: ReportLinksMove) => Promise<void>;

export const moveReportLinksInTx: MoveReportLinksInTx = async (tx, move) => {
  await moveReportAccountLinks(tx, move.environmentId, move.targetId, move.sourceIds);
};
