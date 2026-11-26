/**
 * C99.4 (Workflow 7B; V06, H23): the list screening outbox, which also holds the count the API
 * merges into `inquiry/list_match_count` when it serves it. `createListScreeningInTx`
 * (`apps/api/src/services/lists/screening.ts`) writes one row with {@link createListScreening} in
 * the transition's transaction; the `list-screen-sweep` enqueues the pending rows and the
 * `list-screen` job ends them. `foundation-7b` (Stage 1b (L)) froze the signatures and built the
 * write and the two reads the serving code needs; `api-lists` built the sweep's and the job's.
 */
import type { ListReviewCause, ListScreeningStatus } from '@openverify/core';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { inquiries, listScreenings, type ListScreeningRow } from '../schema.js';

export type ListScreeningTrigger = 'completed' | 'failed' | 'expired';

/** A screening as the serving code reads it (C99.4). */
export type ListScreening = Pick<
  ListScreeningRow,
  | 'status'
  | 'matchCount'
  | 'unscreened'
  | 'notApplicable'
  | 'reviewCause'
  | 'screenedAt'
  | 'createdAt'
>;

/** A pending outbox row, as the sweep reads it. */
export interface PendingListScreening {
  environmentId: string;
  inquiryId: string;
  triggerStatus: ListScreeningTrigger;
  attempts: number;
  enqueuedAt: Date | null;
  createdAt: Date;
  /** Whether the inquiry was redacted after its row was written (the sweep skips it). */
  inquiryRedacted: boolean;
}

/** How the `list-screen` job ends a row, in the transaction that writes the matches. */
export interface ListScreeningOutcome {
  status: Exclude<ListScreeningStatus, 'pending'>;
  matchCount: number | null;
  unscreened: readonly { 'list-id': string; reason: string }[];
  notApplicable: readonly { 'list-id': string; reason: string }[];
  reviewCause: ListReviewCause | null;
  at: Date;
}

const SCREENING_COLUMNS = {
  status: listScreenings.status,
  matchCount: listScreenings.matchCount,
  unscreened: listScreenings.unscreened,
  notApplicable: listScreenings.notApplicable,
  reviewCause: listScreenings.reviewCause,
  screenedAt: listScreenings.screenedAt,
  createdAt: listScreenings.createdAt,
};

/** C99.4: writes the inquiry's row in `tx` (`pending`), once. Returns whether it wrote one. */
export async function createListScreening(
  tx: Db,
  environmentId: string,
  input: { inquiryId: string; triggerStatus: ListScreeningTrigger },
): Promise<boolean> {
  const written = await tx
    .insert(listScreenings)
    .values({ environmentId, inquiryId: input.inquiryId, triggerStatus: input.triggerStatus })
    .onConflictDoNothing()
    .returning({ inquiryId: listScreenings.inquiryId });
  return written.length > 0;
}

/** The inquiry's screening; `null` with no list selected (C99.4 `no_lists_selected`). */
export async function getListScreening(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<ListScreening | null> {
  const rows = await db
    .select(SCREENING_COLUMNS)
    .from(listScreenings)
    .where(
      and(eq(listScreenings.environmentId, environmentId), eq(listScreenings.inquiryId, inquiryId)),
    );
  return rows[0] ?? null;
}

/** The screenings of a page of inquiries, by inquiry id. */
export async function listInquiryListScreenings(
  db: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<Map<string, ListScreening>> {
  if (inquiryIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ ...SCREENING_COLUMNS, inquiryId: listScreenings.inquiryId })
    .from(listScreenings)
    .where(
      and(
        eq(listScreenings.environmentId, environmentId),
        inArray(listScreenings.inquiryId, [...inquiryIds]),
      ),
    );
  return new Map(rows.map(({ inquiryId, ...screening }) => [inquiryId, screening]));
}

const rowOf = (environmentId: string, inquiryId: string) =>
  and(eq(listScreenings.environmentId, environmentId), eq(listScreenings.inquiryId, inquiryId));

const PENDING = eq(listScreenings.status, 'pending');

/** The sweep: pending rows not enqueued since `olderThan`, oldest first, across environments. */
export async function listPendingListScreenings(
  db: Db,
  input: { olderThan: Date; limit: number },
): Promise<PendingListScreening[]> {
  return db
    .select({
      environmentId: listScreenings.environmentId,
      inquiryId: listScreenings.inquiryId,
      triggerStatus: listScreenings.triggerStatus,
      attempts: listScreenings.attempts,
      enqueuedAt: listScreenings.enqueuedAt,
      createdAt: listScreenings.createdAt,
      inquiryRedacted: sql<boolean>`exists (select 1 from ${inquiries}
        where ${inquiries.environmentId} = ${listScreenings.environmentId}
          and ${inquiries.id} = ${listScreenings.inquiryId}
          and ${inquiries.redactedAt} is not null)`,
    })
    .from(listScreenings)
    .where(
      and(
        PENDING,
        or(isNull(listScreenings.enqueuedAt), lt(listScreenings.enqueuedAt, input.olderThan)),
      ),
    )
    .orderBy(
      asc(listScreenings.createdAt),
      asc(listScreenings.environmentId),
      asc(listScreenings.inquiryId),
    )
    .limit(input.limit);
}

/** The sweep: records that the rows were enqueued at `at`. */
export async function markListScreeningsEnqueued(
  db: Db,
  rows: readonly { environmentId: string; inquiryId: string }[],
  at: Date,
): Promise<void> {
  for (const { environmentId, inquiryId } of rows) {
    await db
      .update(listScreenings)
      .set({ enqueuedAt: at })
      .where(and(rowOf(environmentId, inquiryId), PENDING));
  }
}

/** Locks the pending row in `tx`, the job's first step; `false` when another run ended it. */
export async function lockPendingListScreening(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ inquiryId: listScreenings.inquiryId })
    .from(listScreenings)
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .for('update');
  return rows.length > 0;
}

/** Ends a pending row in `tx`; `false` when another run ended it first. */
export async function completeListScreening(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  outcome: ListScreeningOutcome,
): Promise<boolean> {
  const done = await tx
    .update(listScreenings)
    .set({
      status: outcome.status,
      matchCount: outcome.matchCount,
      unscreened: [...outcome.unscreened],
      notApplicable: [...outcome.notApplicable],
      reviewCause: outcome.reviewCause,
      screenedAt: outcome.at,
      lastErrorCode: null,
    })
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .returning({ inquiryId: listScreenings.inquiryId });
  return done.length > 0;
}

/** Counts a failed attempt, with a code and no value; `null` when the row has ended. */
export async function recordListScreeningFailure(
  db: Db,
  environmentId: string,
  inquiryId: string,
  code: string,
): Promise<number | null> {
  const [row] = await db
    .update(listScreenings)
    .set({ attempts: sql`${listScreenings.attempts} + 1`, lastErrorCode: code })
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .returning({ attempts: listScreenings.attempts });
  return row?.attempts ?? null;
}

/**
 * Ends a pending row `errored` with a code: an inquiry redacted after its row was written, which
 * `LIST_SCREENING_STATUSES` has no state of its own for, and a run that kept failing.
 */
export async function failListScreening(
  db: Db,
  environmentId: string,
  inquiryId: string,
  input: { code: string; at: Date; reviewCause?: ListReviewCause | null },
): Promise<boolean> {
  const done = await db
    .update(listScreenings)
    .set({
      status: 'errored',
      lastErrorCode: input.code,
      screenedAt: input.at,
      reviewCause: input.reviewCause ?? null,
    })
    .where(and(rowOf(environmentId, inquiryId), PENDING))
    .returning({ inquiryId: listScreenings.inquiryId });
  return done.length > 0;
}
