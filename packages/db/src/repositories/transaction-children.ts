/**
 * C127.7 (Workflow 8A): what a run triggered by a transaction created. Owner: `api-actions`. A child
 * also attached to the transaction sits in both `transaction_objects` and here (outcome 28).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  accounts,
  graphIndexJobs,
  graphQueries,
  inquiries,
  listItems,
  reports,
  transactionChildren,
  transactions,
  verifications,
  type GraphIndexJobRow,
  type TransactionChildRow,
  type TransactionChildType,
  type TransactionRow,
} from '../schema.js';

export type TransactionChild = TransactionChildRow;

export interface NewTransactionChild {
  transactionId: string;
  childType: TransactionChildType;
  childId: string;
  workflowRunId: string;
}

/** Written in the effect's transaction (C117.5). A repeat changes nothing. */
export async function recordTransactionChild(
  tx: Db,
  environmentId: string,
  input: NewTransactionChild,
): Promise<void> {
  await tx
    .insert(transactionChildren)
    .values({ environmentId, ...input })
    .onConflictDoNothing();
}

export function listTransactionChildren(
  db: Db,
  environmentId: string,
  transactionId: string,
): Promise<TransactionChild[]> {
  return db
    .select()
    .from(transactionChildren)
    .where(
      and(
        eq(transactionChildren.environmentId, environmentId),
        eq(transactionChildren.transactionId, transactionId),
      ),
    )
    .orderBy(asc(transactionChildren.childId));
}

/** The transactions holding `childId`, so a cascade back from a child stops (outcome 28). */
export function listTransactionsOfChild(
  db: Db,
  environmentId: string,
  childId: string,
): Promise<TransactionChild[]> {
  return db
    .select()
    .from(transactionChildren)
    .where(
      and(
        eq(transactionChildren.environmentId, environmentId),
        eq(transactionChildren.childId, childId),
      ),
    )
    .orderBy(asc(transactionChildren.transactionId));
}

/** C127.7 (V27): who last moved the transaction's status, a user, an API key or a run. */
export async function setTransactionReviewer(
  tx: Db,
  environmentId: string,
  transactionId: string,
  reviewer: { type: NonNullable<TransactionRow['reviewerType']>; id: string },
): Promise<void> {
  await tx
    .update(transactions)
    .set({ reviewerType: reviewer.type, reviewerId: reviewer.id, updatedAt: sql`now()` })
    .where(and(eq(transactions.environmentId, environmentId), eq(transactions.id, transactionId)));
}

const RUN_STEP_TABLES = {
  accounts,
  graph_queries: graphQueries,
  inquiries,
  list_items: listItems,
  reports,
  transactions,
  verifications,
} as const;

/** What a run creates with a `workflow_run_step_id` of its own (C117.5). */
export type RunStepObjectTable = keyof typeof RUN_STEP_TABLES;

/** C117.5: names the step that created `id`; the unique key refuses a second object for a step. */
export async function stampObjectRunStep(
  tx: Db,
  table: RunStepObjectTable,
  environmentId: string,
  id: string,
  stepId: string,
): Promise<void> {
  const target = RUN_STEP_TABLES[table];
  await tx
    .update(target)
    .set({ workflowRunStepId: stepId })
    .where(and(eq(target.environmentId, environmentId), eq(target.id, id)));
}

/** C127.5: the graph-index jobs of an account's inquiries, which `sync_graph` polls. */
export async function listAccountGraphIndexJobs(
  db: Db,
  environmentId: string,
  accountId: string,
): Promise<Pick<GraphIndexJobRow, 'inquiryId' | 'status' | 'lastErrorCode'>[]> {
  return db
    .select({
      inquiryId: graphIndexJobs.inquiryId,
      status: graphIndexJobs.status,
      lastErrorCode: graphIndexJobs.lastErrorCode,
    })
    .from(graphIndexJobs)
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, graphIndexJobs.environmentId),
        eq(inquiries.id, graphIndexJobs.inquiryId),
      ),
    )
    .where(and(eq(graphIndexJobs.environmentId, environmentId), eq(inquiries.accountId, accountId)))
    .orderBy(asc(graphIndexJobs.inquiryId));
}
