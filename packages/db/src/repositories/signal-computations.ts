/**
 * C90.5 (Workflow 7A; F02, F03, V17): the signals outbox. `createSignalComputationInTx`
 * (`apps/api/src/services/signals/computation.ts`) writes one row with
 * {@link createSignalComputation} on an inquiry's first move into `completed`, `failed` or
 * `expired`, in the transition's transaction; the `inquiry-signals-sweep` lists the pending rows and
 * enqueues them; the `inquiry-signals` job computes, freezes and completes them. Owner of the
 * sweep and job functions: `api-signals`; `foundation-7a` (Stage 1b (S)) freezes the signatures and
 * builds the write the transition needs.
 */
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { inquiries, inquirySignalComputations } from '../schema.js';

export type SignalComputationTrigger = 'completed' | 'failed' | 'expired';

/** A pending outbox row, as the sweep reads it. */
export interface PendingSignalComputation {
  environmentId: string;
  inquiryId: string;
  triggerStatus: SignalComputationTrigger;
  attempts: number;
  enqueuedAt: Date | null;
  createdAt: Date;
  /** Whether the inquiry was redacted after its row was written (the sweep skips it). */
  inquiryRedacted: boolean;
}

/** What the `inquiry-signals` job freezes on the inquiry. */
export interface InquirySignalsWrite {
  signals: { name: string; value: unknown }[];
  signalDetails: Record<string, unknown>;
  at: Date;
}

/**
 * C90.5: writes the inquiry's outbox row in `tx` (`pending`), once: a later move keeps the first
 * row. Returns whether a row was written.
 */
export async function createSignalComputation(
  tx: Db,
  environmentId: string,
  input: { inquiryId: string; triggerStatus: SignalComputationTrigger },
): Promise<boolean> {
  const written = await tx
    .insert(inquirySignalComputations)
    .values({ environmentId, inquiryId: input.inquiryId, triggerStatus: input.triggerStatus })
    .onConflictDoNothing()
    .returning({ inquiryId: inquirySignalComputations.inquiryId });
  return written.length > 0;
}

/**
 * The sweep: pending rows not enqueued since `enqueuedBefore`, oldest first, across environments.
 */
const PENDING_COLUMNS = {
  environmentId: inquirySignalComputations.environmentId,
  inquiryId: inquirySignalComputations.inquiryId,
  triggerStatus: inquirySignalComputations.triggerStatus,
  attempts: inquirySignalComputations.attempts,
  enqueuedAt: inquirySignalComputations.enqueuedAt,
  createdAt: inquirySignalComputations.createdAt,
  inquiryRedacted: sql<boolean>`exists (select 1 from ${inquiries}
    where ${inquiries.environmentId} = ${inquirySignalComputations.environmentId}
      and ${inquiries.id} = ${inquirySignalComputations.inquiryId}
      and ${inquiries.redactedAt} is not null)`,
};

const rowOf = (environmentId: string, inquiryId: string) =>
  and(
    eq(inquirySignalComputations.environmentId, environmentId),
    eq(inquirySignalComputations.inquiryId, inquiryId),
  );

const PENDING = eq(inquirySignalComputations.state, 'pending');

export async function listPendingSignalComputations(
  db: Db,
  options: { enqueuedBefore: Date; limit: number },
): Promise<PendingSignalComputation[]> {
  return db
    .select(PENDING_COLUMNS)
    .from(inquirySignalComputations)
    .where(
      and(
        PENDING,
        or(
          isNull(inquirySignalComputations.enqueuedAt),
          lt(inquirySignalComputations.enqueuedAt, options.enqueuedBefore),
        ),
      ),
    )
    .orderBy(
      asc(inquirySignalComputations.createdAt),
      asc(inquirySignalComputations.environmentId),
      asc(inquirySignalComputations.inquiryId),
    )
    .limit(options.limit);
}

/**
 * The sweep: records that the rows were enqueued at `at`.
 */
export async function markSignalComputationsEnqueued(
  db: Db,
  rows: readonly { environmentId: string; inquiryId: string }[],
  at: Date,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db
    .update(inquirySignalComputations)
    .set({ enqueuedAt: at })
    .where(and(PENDING, or(...rows.map((row) => rowOf(row.environmentId, row.inquiryId)))));
}

/**
 * The job: freezes the inquiry's `signals` and `signal_details` and marks the row `computed`, in
 * `tx`, only while it is `pending`. Returns whether it did.
 */
export async function completeSignalComputation(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  write: InquirySignalsWrite,
): Promise<boolean> {
  const done = await tx
    .update(inquirySignalComputations)
    .set({ state: 'computed', computedAt: write.at, lastErrorCode: null })
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .returning({ inquiryId: inquirySignalComputations.inquiryId });
  if (done.length === 0) {
    return false;
  }
  await tx
    .update(inquiries)
    .set({ signals: write.signals, signalDetails: write.signalDetails })
    .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.id, inquiryId)));
  return true;
}

/**
 * The job: marks the row `skipped` (an inquiry redacted after its row was written; owner decision
 * 5 after Workflow 6C), computing nothing.
 */
export async function skipSignalComputation(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(inquirySignalComputations)
    .set({ state: 'skipped', updatedAt: at })
    .where(and(rowOf(environmentId, inquiryId), PENDING));
}

/**
 * The job: the inquiry's outbox row while it is `pending`, locked `FOR UPDATE` in `tx` so two runs
 * of one job never compute twice; `null` once computed or skipped.
 */
export async function lockPendingSignalComputation(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<PendingSignalComputation | null> {
  const [row] = await tx
    .select(PENDING_COLUMNS)
    .from(inquirySignalComputations)
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .for('update');
  return row ?? null;
}

/**
 * The job: counts a failed attempt and records its code (a snake-case name, never a value).
 */
export async function recordSignalComputationFailure(
  db: Db,
  environmentId: string,
  inquiryId: string,
  code: string,
): Promise<void> {
  await db
    .update(inquirySignalComputations)
    .set({ attempts: sql`${inquirySignalComputations.attempts} + 1`, lastErrorCode: code })
    .where(and(rowOf(environmentId, inquiryId), PENDING));
}
