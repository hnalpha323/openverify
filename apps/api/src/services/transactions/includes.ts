/**
 * C107.6 (Workflow 7B): the transactions included in an account document
 * (`GET /accounts/:id?include=transactions`): those related to the account, attached or under a
 * relation schema, newest first, at most 50, each masked as `GET /transactions/:id` serves it to the
 * caller. The route authorizes `transactions:read`. Owner: `api-transactions`.
 */
import type { TransactionResource } from '@openverify/contracts';
import { getTransaction, listAccountTransactions, type Db, type Transaction } from '@openverify/db';
import type { PiiMask } from '../../auth/pii.js';
import { transactionResources } from './resources.js';

/** The most transactions one document includes, as C70.5's reports. */
export const MAX_INCLUDED_TRANSACTIONS = 50;

export type IncludedTransactionsFor = (
  tx: Db,
  environmentId: string,
  target: { accountId: string },
  mask: PiiMask,
) => Promise<TransactionResource[]>;

export const includedTransactionsFor: IncludedTransactionsFor = async (
  tx,
  environmentId,
  { accountId },
  mask,
) => {
  const ids = await listAccountTransactions(
    tx,
    environmentId,
    accountId,
    MAX_INCLUDED_TRANSACTIONS,
  );
  const rows: Transaction[] = [];
  for (const id of ids) {
    const row = await getTransaction(tx, environmentId, id);
    if (row !== null) {
      rows.push(row);
    }
  }
  return transactionResources(tx, environmentId, rows, { mask });
};
