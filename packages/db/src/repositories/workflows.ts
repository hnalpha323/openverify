/**
 * C112.3, C116, C121.5 (Workflow 8A): `workflows`. A new workflow is paused, and says so by its reason
 * (`operator`), because a paused workflow always says why. The three version pointers carry no
 * foreign key, and the workflow's row lock keeps them right (C116.1).
 */
import type { WorkflowKind, WorkflowPausedReason, WorkflowStatus } from '@openverify/core';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { workflows, type WorkflowRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export interface NewWorkflow {
  id: string;
  name: string;
  description?: string | null | undefined;
  kind: WorkflowKind;
}

export interface WorkflowChanges {
  name?: string | undefined;
  description?: string | null | undefined;
}

/** What publishing and rollout point a workflow at (C116). */
export interface WorkflowVersionPointers {
  latestPublishedVersionId?: string | null | undefined;
  draftVersionId?: string | null | undefined;
  activeDeploymentId?: string | null | undefined;
}

export interface WorkflowFilters {
  statuses?: readonly WorkflowStatus[] | undefined;
  kinds?: readonly WorkflowKind[] | undefined;
}

const workflowCursor = environmentCursor(workflows);

const scoped = (environmentId: string, id: string) =>
  and(eq(workflows.environmentId, environmentId), eq(workflows.id, id));

export async function createWorkflow(
  tx: Db,
  environmentId: string,
  input: NewWorkflow,
): Promise<WorkflowRow> {
  return inserted(
    await tx
      .insert(workflows)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        pausedReason: 'operator',
      })
      .returning(),
    'workflow',
  );
}

export async function getWorkflow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRow | null> {
  return firstOrNull(await db.select().from(workflows).where(scoped(environmentId, id)).limit(1));
}

/** The workflow's row, locked: publishing, rollout and archive all hold it (C116.1). */
export async function lockWorkflow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowRow | null> {
  return firstOrNull(
    await tx.select().from(workflows).where(scoped(environmentId, id)).limit(1).for('update'),
  );
}

/** `created_at DESC, id DESC` (C1). */
export async function listWorkflows(
  db: Db,
  environmentId: string,
  filters: WorkflowFilters,
  page: PageRequest,
): Promise<Page<WorkflowRow>> {
  const conditions = allFilters([
    eq(workflows.environmentId, environmentId),
    equalsAny(workflows.status, filters.statuses),
    equalsAny(workflows.kind, filters.kinds),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, workflowCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(workflows)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(workflowCursor))
      .limit(limit),
  );
}

export async function updateWorkflow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: WorkflowChanges,
): Promise<WorkflowRow | null> {
  return firstOrNull(
    await tx
      .update(workflows)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.description === undefined ? {} : { description: changes.description }),
        updatedAt: sql`now()`,
      })
      .where(scoped(environmentId, id))
      .returning(),
  );
}

export async function setWorkflowVersionPointers(
  tx: Db,
  environmentId: string,
  id: string,
  pointers: WorkflowVersionPointers,
): Promise<WorkflowRow | null> {
  const { latestPublishedVersionId, draftVersionId, activeDeploymentId } = pointers;
  return firstOrNull(
    await tx
      .update(workflows)
      .set({
        ...(latestPublishedVersionId === undefined ? {} : { latestPublishedVersionId }),
        ...(draftVersionId === undefined ? {} : { draftVersionId }),
        ...(activeDeploymentId === undefined ? {} : { activeDeploymentId }),
        updatedAt: sql`now()`,
      })
      .where(scoped(environmentId, id))
      .returning(),
  );
}

/** `pausedReason` is set exactly when `status` is `paused`; archiving stamps `archived_at`. */
export async function setWorkflowStatus(
  tx: Db,
  environmentId: string,
  id: string,
  status: WorkflowStatus,
  pausedReason: WorkflowPausedReason | null,
  at: Date,
): Promise<WorkflowRow | null> {
  return firstOrNull(
    await tx
      .update(workflows)
      .set({
        status,
        pausedReason: status === 'paused' ? pausedReason : null,
        archivedAt: status === 'archived' ? at : null,
        updatedAt: sql`now()`,
      })
      .where(scoped(environmentId, id))
      .returning(),
  );
}

/** C121.5: the workflows the publisher-rights sweep checks, in every environment, by id. */
export async function listRunningWorkflows(
  db: Db,
  options: { after?: string | null | undefined; limit: number },
): Promise<WorkflowRow[]> {
  const { after } = options;
  return db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.status, 'running'),
        after === null || after === undefined ? undefined : gt(workflows.id, after),
      ),
    )
    .orderBy(asc(workflows.id))
    .limit(options.limit);
}

/** C112.2: a promote finds its target by name and kind, in one environment. */
export async function listWorkflowsNamed(
  db: Db,
  environmentId: string,
  name: string,
  kind: WorkflowKind,
): Promise<WorkflowRow[]> {
  return db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.environmentId, environmentId),
        eq(workflows.name, name),
        eq(workflows.kind, kind),
      ),
    )
    .orderBy(asc(workflows.id))
    .limit(2);
}
