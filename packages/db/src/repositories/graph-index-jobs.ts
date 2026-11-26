/**
 * C101.3 (Workflow 7B; H23): `graph_index_jobs`, the outbox of an inquiry's first move into
 * `completed`, `failed` or `expired`. `createGraphIndexJob` is built here (`foundation-7b`, Stage 1b
 * (G)), for the hook in `transitionInquiryInTx`; the rest is `api-graph`'s.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { graphIndexJobs, type GraphIndexJobRow, type GraphIndexTrigger } from '../schema.js';

export interface PendingGraphIndexJob {
  environmentId: string;
  inquiryId: string;
  /** Redacted after its row was written: the sweep ends the row `skipped`, never enqueues it. */
  inquiryRedacted: boolean;
}

/**
 * Writes the inquiry's pending row in `tx`; a later call for the same inquiry keeps the first and
 * answers `false`.
 */
export async function createGraphIndexJob(
  tx: Db,
  environmentId: string,
  input: { inquiryId: string; triggerStatus: GraphIndexTrigger },
): Promise<boolean> {
  const written = await tx
    .insert(graphIndexJobs)
    .values({ environmentId, inquiryId: input.inquiryId, triggerStatus: input.triggerStatus })
    .onConflictDoNothing()
    .returning({ inquiryId: graphIndexJobs.inquiryId });
  return written.length > 0;
}

/** The inquiry's row; `null` before its first move out of `pending`. */
export async function getGraphIndexJob(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<GraphIndexJobRow | null> {
  const rows = await db
    .select()
    .from(graphIndexJobs)
    .where(
      and(eq(graphIndexJobs.environmentId, environmentId), eq(graphIndexJobs.inquiryId, inquiryId)),
    );
  return rows[0] ?? null;
}

/**
 * The `graph-index-sweep`'s read: pending rows not enqueued since `olderThan`, oldest first, with
 * whether the inquiry was redacted after the row was written.
 */
export async function listPendingGraphIndexJobs(
  db: Db,
  options: { olderThan: Date; limit: number },
): Promise<PendingGraphIndexJob[]> {
  const result = await db.execute<{
    environment_id: string;
    inquiry_id: string;
    redacted: boolean;
  }>(sql`
    select j.environment_id, j.inquiry_id, (i.redacted_at is not null) as redacted
    from graph_index_jobs j
    join inquiries i on i.environment_id = j.environment_id and i.id = j.inquiry_id
    where j.status = 'pending'
      and (j.enqueued_at is null or j.enqueued_at < ${options.olderThan.toISOString()}::timestamptz)
    order by j.created_at, j.inquiry_id
    limit ${options.limit}`);
  const rows = (
    result as { rows: { environment_id: string; inquiry_id: string; redacted: boolean }[] }
  ).rows;
  return rows.map((row) => ({
    environmentId: row.environment_id,
    inquiryId: row.inquiry_id,
    inquiryRedacted: row.redacted,
  }));
}

export async function markGraphIndexJobsEnqueued(
  db: Db,
  jobs: readonly { environmentId: string; inquiryId: string }[],
  at: Date,
): Promise<void> {
  for (const job of jobs) {
    await db
      .update(graphIndexJobs)
      .set({ enqueuedAt: at })
      .where(
        and(
          eq(graphIndexJobs.environmentId, job.environmentId),
          eq(graphIndexJobs.inquiryId, job.inquiryId),
          eq(graphIndexJobs.status, 'pending'),
        ),
      );
  }
}

/** Ends a pending row: `completed`, `skipped` or `errored`, with a code for the last two. */
export async function endGraphIndexJob(
  tx: Db,
  environmentId: string,
  inquiryId: string,
  outcome: { status: 'completed' | 'skipped' | 'errored'; code?: string; at: Date },
): Promise<boolean> {
  const ended = await tx
    .update(graphIndexJobs)
    .set({
      status: outcome.status,
      indexedAt: outcome.at,
      ...(outcome.code === undefined ? {} : { lastErrorCode: outcome.code }),
    })
    .where(
      and(
        eq(graphIndexJobs.environmentId, environmentId),
        eq(graphIndexJobs.inquiryId, inquiryId),
        eq(graphIndexJobs.status, 'pending'),
      ),
    )
    .returning({ inquiryId: graphIndexJobs.inquiryId });
  return ended.length > 0;
}

/** Counts one run of the `graph-index` job on a pending row; answers the attempts so far. */
export async function recordGraphIndexJobAttempt(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<number> {
  const [row] = await tx
    .update(graphIndexJobs)
    .set({ attempts: sql`${graphIndexJobs.attempts} + 1` })
    .where(
      and(
        eq(graphIndexJobs.environmentId, environmentId),
        eq(graphIndexJobs.inquiryId, inquiryId),
        eq(graphIndexJobs.status, 'pending'),
      ),
    )
    .returning({ attempts: graphIndexJobs.attempts });
  return row?.attempts ?? 0;
}
