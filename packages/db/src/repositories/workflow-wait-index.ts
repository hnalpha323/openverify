/**
 * C119.3 (Workflow 8A): `workflow_wait_index`. Publishing records each (environment, event name) a
 * version waits on, and `stage()` writes a candidate only for a name found here.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { workflowRuns, workflowVersions, workflowWaitIndex } from '../schema.js';

export async function recordWorkflowWaitIndex(
  tx: Db,
  environmentId: string,
  workflowVersionId: string,
  eventNames: readonly string[],
): Promise<void> {
  const names = [...new Set(eventNames)];
  if (names.length === 0) {
    return;
  }
  await tx
    .insert(workflowWaitIndex)
    .values(names.map((eventName) => ({ environmentId, eventName, workflowVersionId })))
    .onConflictDoNothing();
}

export async function removeWorkflowWaitIndex(
  tx: Db,
  environmentId: string,
  workflowVersionId: string,
): Promise<void> {
  await tx
    .delete(workflowWaitIndex)
    .where(
      and(
        eq(workflowWaitIndex.environmentId, environmentId),
        eq(workflowWaitIndex.workflowVersionId, workflowVersionId),
      ),
    );
}

/**
 * C119.3: a version nobody can still wait through: archived before `archivedBefore`, with no
 * unfinished run. An archived version keeps its index while a run of it lives, so that run's wait
 * still hears its event, and a retired one stops writing candidates for an event nobody awaits.
 */
export async function removeRetiredWorkflowWaitIndex(tx: Db, archivedBefore: Date): Promise<void> {
  await tx.delete(workflowWaitIndex).where(
    sql`exists (
      select 1 from ${workflowVersions}
      where ${workflowVersions.id} = ${workflowWaitIndex.workflowVersionId}
        and ${workflowVersions.environmentId} = ${workflowWaitIndex.environmentId}
        and ${workflowVersions.status} = 'archived'
        and ${workflowVersions.updatedAt} < ${archivedBefore.toISOString()}::timestamptz
        and not exists (
          select 1 from ${workflowRuns}
          where ${workflowRuns.environmentId} = ${workflowVersions.environmentId}
            and ${workflowRuns.workflowVersionId} = ${workflowVersions.id}
            and ${workflowRuns.status} = 'in_progress'))`,
  );
}
