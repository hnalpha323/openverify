/**
 * C150.9 (Workflow 9A): the provisional signal snapshots a branch waits for. Owner:
 * `api-flow-actions`; frozen by `foundation-9a` (S). PII-free (counts, levels, a country code and
 * distances); deleted with the step record they belong to.
 *
 * Also the branch entries an inquiry waits at (C150.5): the snapshot job advances only an entry the
 * inquiry still waits at, and `flow-action-sweep` ends the waits whose deadline passed (V09). The
 * step record is `api-flow-engine`'s; these read it.
 */
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  inquiries,
  inquiryFlowSignalSnapshots,
  inquiryFlowSteps,
  type InquiryFlowSignalSnapshotRow,
} from '../schema.js';

export type InquiryFlowSignalSnapshot = InquiryFlowSignalSnapshotRow;

/** One signal's snapshot: a value, or `null` with its reason (`not_yet_collected` included, V06). */
export interface NewInquiryFlowSignalSnapshot {
  name: string;
  value: unknown;
  tier: string;
  stage: string;
  nullReason: string | null;
  computedAt: Date;
}

/**
 * Writes the branch entry's snapshots, once per name (a repeated write keeps the first), and
 * answers the rows this call wrote.
 */
export async function insertInquiryFlowSignalSnapshotsInTx(
  tx: Db,
  environmentId: string,
  key: { inquiryId: string; stepRecordSeq: number },
  snapshots: readonly NewInquiryFlowSignalSnapshot[],
): Promise<InquiryFlowSignalSnapshot[]> {
  if (snapshots.length === 0) {
    return [];
  }
  return tx
    .insert(inquiryFlowSignalSnapshots)
    .values(
      snapshots.map((snapshot) => ({
        environmentId,
        inquiryId: key.inquiryId,
        stepRecordSeq: key.stepRecordSeq,
        name: snapshot.name,
        value: snapshot.value ?? null,
        tier: snapshot.tier,
        stage: snapshot.stage,
        nullReason: snapshot.nullReason,
        computedAt: snapshot.computedAt,
      })),
    )
    .onConflictDoNothing()
    .returning();
}

/**
 * C150.5, C150.9: a branch entry the inquiry waits at: its position is `waiting` and the entry is
 * the open one of a `branch` step.
 */
export interface WaitingBranchEntry {
  environmentId: string;
  inquiryId: string;
  stepRecordSeq: number;
  stepId: string;
  enteredAt: Date;
}

const waitingBranch = and(
  eq(inquiries.flowState, 'waiting'),
  eq(inquiries.flowStepId, inquiryFlowSteps.stepId),
  eq(inquiryFlowSteps.stepType, 'branch'),
  isNull(inquiryFlowSteps.exitedAt),
  // The newest entry of the inquiry: an older open one is never the wait.
  sql`${inquiryFlowSteps.seq} = (
    select max(latest.seq) from inquiry_flow_steps latest
     where latest.environment_id = ${inquiryFlowSteps.environmentId}
       and latest.inquiry_id = ${inquiryFlowSteps.inquiryId})`,
);

const waitingColumns = {
  environmentId: inquiryFlowSteps.environmentId,
  inquiryId: inquiryFlowSteps.inquiryId,
  stepRecordSeq: inquiryFlowSteps.seq,
  stepId: inquiryFlowSteps.stepId,
  enteredAt: inquiryFlowSteps.enteredAt,
};

const ofInquiry = and(
  eq(inquiries.environmentId, inquiryFlowSteps.environmentId),
  eq(inquiries.id, inquiryFlowSteps.inquiryId),
);

/** The inquiry's branch entry `stepRecordSeq` while the inquiry still waits there, else `null`. */
export async function getWaitingBranchEntry(
  db: Db,
  environmentId: string,
  key: { inquiryId: string; stepRecordSeq: number },
): Promise<WaitingBranchEntry | null> {
  const [row] = await db
    .select(waitingColumns)
    .from(inquiryFlowSteps)
    .innerJoin(inquiries, ofInquiry)
    .where(
      and(
        eq(inquiryFlowSteps.environmentId, environmentId),
        eq(inquiryFlowSteps.inquiryId, key.inquiryId),
        eq(inquiryFlowSteps.seq, key.stepRecordSeq),
        waitingBranch,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** C150.9 (V09): branch entries waited at, oldest first, for `flow-action-sweep`. */
export function listWaitingBranchEntries(
  db: Db,
  options: { enteredBefore: Date; limit: number },
): Promise<WaitingBranchEntry[]> {
  return db
    .select(waitingColumns)
    .from(inquiryFlowSteps)
    .innerJoin(inquiries, ofInquiry)
    .where(and(lt(inquiryFlowSteps.enteredAt, options.enteredBefore), waitingBranch))
    .orderBy(
      asc(inquiryFlowSteps.enteredAt),
      asc(inquiryFlowSteps.environmentId),
      asc(inquiryFlowSteps.inquiryId),
    )
    .limit(options.limit);
}

/** The snapshots of one branch entry, by name. */
export function listInquiryFlowSignalSnapshots(
  db: Db,
  environmentId: string,
  key: { inquiryId: string; stepRecordSeq: number },
): Promise<InquiryFlowSignalSnapshot[]> {
  return db
    .select()
    .from(inquiryFlowSignalSnapshots)
    .where(
      and(
        eq(inquiryFlowSignalSnapshots.environmentId, environmentId),
        eq(inquiryFlowSignalSnapshots.inquiryId, key.inquiryId),
        eq(inquiryFlowSignalSnapshots.stepRecordSeq, key.stepRecordSeq),
      ),
    )
    .orderBy(asc(inquiryFlowSignalSnapshots.name));
}
