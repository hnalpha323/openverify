/**
 * Owner decision 8 after Workflow 7B: a transaction's status history and labels, read newest first
 * with a cursor. The history is unbounded and append-only, so it stays off the transaction
 * resource; its free text is `null` once redacted, and a redacted label is left out.
 */
import type {
  ListTransactionStatusChangesQuery,
  TransactionLabelListDocument,
  TransactionStatusChangeListDocument,
  TransactionStatusChangeResource,
} from '@openverify/contracts';
import {
  getTransaction,
  listTransactionLabels,
  listTransactionStatusHistory,
  type Db,
  type TransactionStatusHistoryRow,
} from '@openverify/db';
import { NotFoundError } from '../../errors.js';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { TransactionActing } from './acting.js';
import { transactionLabelResource } from './resources.js';

/** @throws {NotFoundError} for a transaction this environment does not hold. */
export async function assertTransactionHeld(db: Db, environmentId: string, id: string): Promise<void> {
  if ((await getTransaction(db, environmentId, id)) === null) {
    throw new NotFoundError(`Transaction ${id} was not found.`);
  }
}

function actorTypeOf(
  row: TransactionStatusHistoryRow,
): TransactionStatusChangeResource['attributes']['actor-type'] {
  switch (row.actorType) {
    case 'api_key':
      return 'api-key';
    case 'user':
      return 'user';
    case 'system':
      return 'system';
    case 'workflow_run':
      return 'workflow-run';
  }
}

function statusChangeResource(row: TransactionStatusHistoryRow): TransactionStatusChangeResource {
  return {
    type: 'transaction-status-change',
    id: String(row.id),
    attributes: {
      'from-status': row.fromStatus,
      'to-status': row.toStatus,
      'actor-type': actorTypeOf(row),
      'created-at': row.createdAt.toISOString(),
      'redacted-at': row.redactedAt === null ? null : row.redactedAt.toISOString(),
    },
  };
}

/** `GET /transactions/:id/status-changes`. */
export async function listTransactionStatusChanges(
  { db }: ApiDependencies,
  acting: TransactionActing,
  id: string,
  query: ListTransactionStatusChangesQuery,
): Promise<TransactionStatusChangeListDocument> {
  const { environmentId } = acting.ctx;
  await assertTransactionHeld(db, environmentId, id);
  const page = await withCursor(() =>
    listTransactionStatusHistory(db, environmentId, id, pageRequest(query)),
  );
  return {
    data: page.items.map(statusChangeResource),
    links: { next: nextLink(`/api/v1/transactions/${id}/status-changes`, {}, query, page.next) },
  };
}

/** `GET /transactions/:id/labels`. */
export async function listTransactionLabelsDocument(
  { db }: ApiDependencies,
  acting: TransactionActing,
  id: string,
  query: Parameters<typeof pageRequest>[0],
): Promise<TransactionLabelListDocument> {
  const { environmentId } = acting.ctx;
  await assertTransactionHeld(db, environmentId, id);
  const page = await withCursor(() =>
    listTransactionLabels(db, environmentId, id, pageRequest(query)),
  );
  return {
    data: page.items.map(transactionLabelResource),
    links: { next: nextLink(`/api/v1/transactions/${id}/labels`, {}, query, page.next) },
  };
}
