/**
 * C101.5 (Workflow 7B; H10, V11): `graph_index_state`, one row per environment and kind. A kind with
 * no row is complete since the environment began. Owner: `api-graph`; `foundation-7b` (Stage 1b
 * (G)) froze the signatures.
 */
import { and, asc, eq, gt, isNull, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  accounts,
  environments,
  graphIndexState,
  inquiries,
  type GraphIndexStateRow,
} from '../schema.js';

/** The environment's rows in kind order; a kind without one is complete. Built by `foundation-7b`. */
export async function listGraphIndexStates(
  db: Db,
  environmentId: string,
): Promise<GraphIndexStateRow[]> {
  return db
    .select()
    .from(graphIndexState)
    .where(eq(graphIndexState.environmentId, environmentId))
    .orderBy(asc(graphIndexState.kind));
}

/**
 * A switch that starts writing kinds (re-enabling `graph-indexing`, turning `graph-weak-kinds` on,
 * enabling device recognition) marks them incomplete from `at`, in the settings transaction; the
 * backfill starts over.
 */
export async function markGraphKindsIncomplete(
  tx: Db,
  environmentId: string,
  kinds: readonly number[],
  at: Date,
): Promise<void> {
  if (kinds.length === 0) {
    return;
  }
  await tx
    .insert(graphIndexState)
    .values(
      [...new Set(kinds)].map((kind) => ({
        environmentId,
        kind,
        indexedSince: at,
        complete: false,
        backfillCursor: null,
        completedAt: null,
      })),
    )
    .onConflictDoUpdate({
      target: [graphIndexState.environmentId, graphIndexState.kind],
      set: {
        indexedSince: sql`excluded.indexed_since`,
        complete: false,
        backfillCursor: null,
        completedAt: null,
      },
    });
}

/** The `graph-backfill` job's read: incomplete rows, oldest first, across environments. */
export async function listIncompleteGraphIndexStates(
  db: Db,
  options: { limit: number },
): Promise<GraphIndexStateRow[]> {
  return db
    .select()
    .from(graphIndexState)
    .where(eq(graphIndexState.complete, false))
    .orderBy(
      asc(graphIndexState.indexedSince),
      asc(graphIndexState.environmentId),
      asc(graphIndexState.kind),
    )
    .limit(options.limit);
}

/** Records where a backfill batch stopped, or that the kind is complete. */
export async function advanceGraphBackfill(
  tx: Db,
  environmentId: string,
  kind: number,
  progress: { cursor: Record<string, unknown> | null; complete: boolean; at: Date },
): Promise<void> {
  await tx
    .update(graphIndexState)
    .set({
      backfillCursor: progress.complete ? null : progress.cursor,
      complete: progress.complete,
      completedAt: progress.complete ? progress.at : null,
    })
    .where(and(eq(graphIndexState.environmentId, environmentId), eq(graphIndexState.kind, kind)));
}

/**
 * C101.5: the backfill's walk over an environment's accounts, by id after `after`: those not
 * redacted and not absorbed by a consolidation (their rows moved to the survivor).
 */
export async function listGraphBackfillAccounts(
  db: Db,
  environmentId: string,
  page: { after: string | null; limit: number },
): Promise<string[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.environmentId, environmentId),
        isNull(accounts.redactedAt),
        isNull(accounts.consolidatedInto),
        page.after === null ? undefined : gt(accounts.id, page.after),
      ),
    )
    .orderBy(asc(accounts.id))
    .limit(page.limit);
  return rows.map(({ id }) => id);
}

/**
 * C101.5: the backfill's walk over an environment's inquiries past their first move into an end
 * state, by id after `after`, the redacted left out.
 */
export async function listGraphBackfillInquiries(
  db: Db,
  environmentId: string,
  page: { after: string | null; limit: number },
): Promise<string[]> {
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(
      and(
        eq(inquiries.environmentId, environmentId),
        isNull(inquiries.redactedAt),
        notInArray(inquiries.status, ['created', 'pending']),
        page.after === null ? undefined : gt(inquiries.id, page.after),
      ),
    )
    .orderBy(asc(inquiries.id))
    .limit(page.limit);
  return rows.map(({ id }) => id);
}

/** `graph:reindex` without `--environment`: every environment, by id. */
export async function listGraphEnvironmentIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: environments.id })
    .from(environments)
    .orderBy(asc(environments.id));
  return rows.map(({ id }) => id);
}

/** C101.5: `graph:reindex` marks every kind of the environment complete at its end. */
export async function completeGraphIndexStates(
  tx: Db,
  environmentId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(graphIndexState)
    .set({ complete: true, completedAt: at, backfillCursor: null })
    .where(
      and(eq(graphIndexState.environmentId, environmentId), eq(graphIndexState.complete, false)),
    );
}
