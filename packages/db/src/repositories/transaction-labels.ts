/**
 * C105.2 (Workflow 7B): `transaction_labels`, append-only history; the latest is served (the
 * redaction nulls its free text, `transaction-redaction.ts`). Owner: `api-transactions`.
 *
 * A redacted label has no `model-label`, which `transactionLabelResourceSchema` requires, so the
 * reads leave redacted labels out and a redacted transaction's `transaction-label` reads `null`.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { transactionLabels, type TransactionLabelRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { inserted } from './rows.js';

export interface NewTransactionLabel {
  id: string;
  transactionId: string;
  label: string;
  modelVersion: string | null;
  score: number | null;
}

export async function addTransactionLabel(
  tx: Db,
  environmentId: string,
  input: NewTransactionLabel,
): Promise<TransactionLabelRow> {
  return inserted(
    await tx
      .insert(transactionLabels)
      .values({ environmentId, ...input })
      .returning(),
    'addTransactionLabel',
  );
}

const labelCursor = environmentCursor(transactionLabels);

const unredactedOf = (environmentId: string) =>
  and(eq(transactionLabels.environmentId, environmentId), isNull(transactionLabels.redactedAt));

/** The latest unredacted label of each transaction that has one. */
export async function latestTransactionLabels(
  db: Db,
  environmentId: string,
  transactionIds: readonly string[],
): Promise<ReadonlyMap<string, TransactionLabelRow>> {
  if (transactionIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([transactionLabels.transactionId])
    .from(transactionLabels)
    .where(
      and(
        unredactedOf(environmentId),
        inArray(transactionLabels.transactionId, [...transactionIds]),
      ),
    )
    .orderBy(
      transactionLabels.transactionId,
      desc(transactionLabels.createdAt),
      desc(transactionLabels.id),
    );
  return new Map(rows.map((row) => [row.transactionId, row]));
}

/** `GET /transactions/:id/labels`: `created_at DESC, id DESC`, unredacted labels only. */
export async function listTransactionLabels(
  db: Db,
  environmentId: string,
  transactionId: string,
  page: PageRequest = {},
): Promise<Page<TransactionLabelRow>> {
  return paginate(db, labelCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(transactionLabels)
      .where(
        and(unredactedOf(environmentId), eq(transactionLabels.transactionId, transactionId), after),
      )
      .orderBy(...newestFirst(labelCursor))
      .limit(limit),
  );
}
