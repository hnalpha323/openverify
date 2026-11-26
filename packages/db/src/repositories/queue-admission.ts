/**
 * C251.1 (Workflow 11B Stage 1b (P)): the admission stamp of a produced row, for the producers that
 * `foundation-11b`'s hook wraps (`process-verification` on `verifications`, `report-run` on
 * `report_runs`). `quotas`' admission (`services/quotas/admit.ts`) stamps through it; the counts, the
 * claims and the slots are `quotas`' `queue-slots.ts`.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import { reportRuns } from '../tables/reports.js';
import { verifications } from '../tables/verifications.js';

/** The rows a wrapped producer writes before its job. */
export type StampedQueue = 'process-verification' | 'report-run';

/** Stamps `admitted_at` on the row, once (a stamped row keeps its first time). */
export async function stampQueueRowAdmitted(
  db: Db,
  queue: StampedQueue,
  environmentId: string,
  id: string,
  at: Date,
): Promise<void> {
  if (queue === 'process-verification') {
    await db
      .update(verifications)
      .set({ admittedAt: at })
      .where(
        and(
          eq(verifications.environmentId, environmentId),
          eq(verifications.id, id),
          isNull(verifications.admittedAt),
        ),
      );
    return;
  }
  await db
    .update(reportRuns)
    .set({ admittedAt: at })
    .where(
      and(
        eq(reportRuns.environmentId, environmentId),
        eq(reportRuns.id, id),
        isNull(reportRuns.admittedAt),
      ),
    );
}
