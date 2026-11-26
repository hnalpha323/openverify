/**
 * C105.4 (Workflow 7B): `transaction_status_history`, append-only (the C73 trigger pattern; the
 * redaction nulls its free text, `transaction-redaction.ts`). Owner: `api-transactions`.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { transactionStatusHistory, type TransactionStatusHistoryRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { inserted } from './rows.js';

const historyCursor = environmentCursor(transactionStatusHistory);

export interface NewTransactionStatus {
  transactionId: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: TransactionStatusHistoryRow['actorType'];
  actorId: string | null;
}

export async function appendTransactionStatus(
  tx: Db,
  environmentId: string,
  input: NewTransactionStatus,
): Promise<TransactionStatusHistoryRow> {
  return inserted(
    await tx
      .insert(transactionStatusHistory)
      .values({ environmentId, ...input })
      .returning(),
    'appendTransactionStatus',
  );
}

/** `GET /transactions/:id/status-changes`: `created_at DESC, id DESC`. */
export async function listTransactionStatusHistory(
  db: Db,
  environmentId: string,
  transactionId: string,
  page: PageRequest = {},
): Promise<Page<TransactionStatusHistoryRow>> {
  return paginate(
    db,
    historyCursor,
    environmentId,
    page,
    (after, limit) =>
      db
        .select()
        .from(transactionStatusHistory)
        .where(
          and(
            eq(transactionStatusHistory.environmentId, environmentId),
            eq(transactionStatusHistory.transactionId, transactionId),
            after,
          ),
        )
        .orderBy(...newestFirst(historyCursor))
        .limit(limit),
    (row) => String(row.id),
  );
}
