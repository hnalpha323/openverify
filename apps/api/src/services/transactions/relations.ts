/**
 * K7C-2 (C105.2, C108): a transaction's relations, read newest first with a cursor. A `many`
 * relation has no cap, so they stay off the transaction resource. A relation holds ids, a key and a
 * time, and a redaction leaves it (C105.5), so a redacted transaction's relations read as they did.
 */
import type {
  ListTransactionRelationsQuery,
  TransactionRelationListDocument,
  TransactionRelationResource,
} from '@openverify/contracts';
import { listTransactionRelationsPage, type TransactionRelationRow } from '@openverify/db';
import type { ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { TransactionActing } from './acting.js';
import { assertTransactionHeld } from './history.js';

function relationResource(row: TransactionRelationRow): TransactionRelationResource {
  return {
    type: 'transaction-relation',
    id: `${row.transactionId}:${row.relationSchemaKey}:${row.targetId}`,
    attributes: {
      'relation-schema-key': row.relationSchemaKey,
      target:
        row.accountId === null
          ? { type: 'transaction', id: row.targetId }
          : { type: 'account', id: row.accountId },
      'created-at': row.createdAt.toISOString(),
    },
  };
}

/** `GET /transactions/:id/relations`. */
export async function listTransactionRelationsDocument(
  { db }: ApiDependencies,
  acting: TransactionActing,
  id: string,
  query: ListTransactionRelationsQuery,
): Promise<TransactionRelationListDocument> {
  const { environmentId } = acting.ctx;
  await assertTransactionHeld(db, environmentId, id);
  const page = await withCursor(() =>
    listTransactionRelationsPage(db, environmentId, id, pageRequest(query)),
  );
  return {
    data: page.items.map(relationResource),
    links: { next: nextLink(`/api/v1/transactions/${id}/relations`, {}, query, page.next) },
  };
}
