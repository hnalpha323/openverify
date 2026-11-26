/**
 * C118.1 (Workflow 8A): `workflow_trigger_deliveries`. Owner: `api-triggers`.
 *
 * A delivery is written in its event's own transaction, so it exists if and only if the event
 * committed. The rows are the outbox: `dispatch()` wakes a job after the commit, and the sweep wakes
 * whatever that lost.
 */
import type { WorkflowDeliveryStatus } from '@openverify/core';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  environments,
  workflowTriggerDeliveries,
  type WorkflowTriggerDeliveryRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { DEFAULT_RETENTION } from './retention.js';

/** A job this old has been lost: the sweep wakes its delivery again (C118.1). */
const ENQUEUE_GRACE_MS = 5 * 60_000;

const CHAIN_LIMIT = 64;

export interface NewWorkflowDelivery {
  id: string;
  eventId: string;
  eventName: string;
  workflowId: string;
  /** C117.7: the delivery past the fan-out cap is written `refused`, with its reason. */
  status?: 'refused' | undefined;
  reasonCode?: string | undefined;
}

export interface WorkflowDeliveryFilters {
  workflowIds?: readonly string[] | undefined;
  statuses?: readonly WorkflowDeliveryStatus[] | undefined;
}

export interface WorkflowDeliveryOutcome {
  status: Exclude<WorkflowDeliveryStatus, 'pending'>;
  reasonCode?: string | null | undefined;
  workflowRunId?: string | null | undefined;
}

/** C118.1: `ON CONFLICT (event_id, workflow_id) DO NOTHING`; the rows it wrote. */
export async function createWorkflowDeliveries(
  tx: Db,
  environmentId: string,
  deliveries: readonly NewWorkflowDelivery[],
): Promise<WorkflowTriggerDeliveryRow[]> {
  if (deliveries.length === 0) {
    return [];
  }
  return tx
    .insert(workflowTriggerDeliveries)
    .values(
      deliveries.map((delivery) => {
        const status: WorkflowDeliveryStatus = delivery.status ?? 'pending';
        return {
          id: delivery.id,
          environmentId,
          eventId: delivery.eventId,
          eventName: delivery.eventName,
          workflowId: delivery.workflowId,
          status,
          reasonCode: delivery.reasonCode ?? null,
        };
      }),
    )
    .onConflictDoNothing({
      target: [workflowTriggerDeliveries.eventId, workflowTriggerDeliveries.workflowId],
    })
    .returning();
}

const scoped = (environmentId: string, id: string): SQL | undefined =>
  and(
    eq(workflowTriggerDeliveries.environmentId, environmentId),
    eq(workflowTriggerDeliveries.id, id),
  );

export async function lockWorkflowDelivery(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowTriggerDeliveryRow | null> {
  const [row] = await tx
    .select()
    .from(workflowTriggerDeliveries)
    .where(scoped(environmentId, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

/**
 * The sweep's read: pending, due, and not woken in the last few minutes, `FOR UPDATE SKIP LOCKED`.
 * Each row it returns is stamped, so the next sweep leaves it until its job has had time to run.
 */
export async function listPendingWorkflowDeliveries(
  tx: Db,
  options: { limit: number; now: Date },
): Promise<WorkflowTriggerDeliveryRow[]> {
  const { now, limit } = options;
  const stale = new Date(now.getTime() - ENQUEUE_GRACE_MS);
  const rows = await tx
    .select({ id: workflowTriggerDeliveries.id })
    .from(workflowTriggerDeliveries)
    .where(
      and(
        eq(workflowTriggerDeliveries.status, 'pending'),
        or(
          isNull(workflowTriggerDeliveries.notBefore),
          lte(workflowTriggerDeliveries.notBefore, now),
        ),
        or(
          isNull(workflowTriggerDeliveries.enqueuedAt),
          lt(workflowTriggerDeliveries.enqueuedAt, stale),
        ),
      ),
    )
    .orderBy(asc(workflowTriggerDeliveries.createdAt), asc(workflowTriggerDeliveries.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (rows.length === 0) {
    return [];
  }
  return tx
    .update(workflowTriggerDeliveries)
    .set({ enqueuedAt: now })
    .where(
      inArray(
        workflowTriggerDeliveries.id,
        rows.map((row) => row.id),
      ),
    )
    .returning();
}

/** C117.8: it waits, and is never dropped. The sweep wakes it at `notBefore`. */
export async function deferWorkflowDelivery(
  tx: Db,
  environmentId: string,
  id: string,
  notBefore: Date,
): Promise<void> {
  await tx
    .update(workflowTriggerDeliveries)
    .set({ notBefore, enqueuedAt: null })
    .where(and(scoped(environmentId, id), eq(workflowTriggerDeliveries.status, 'pending')));
}

/** A delivery finishes once: `null` when it has already finished. */
export async function finishWorkflowDelivery(
  tx: Db,
  environmentId: string,
  id: string,
  outcome: WorkflowDeliveryOutcome,
): Promise<WorkflowTriggerDeliveryRow | null> {
  const [row] = await tx
    .update(workflowTriggerDeliveries)
    .set({
      status: outcome.status,
      reasonCode: outcome.reasonCode ?? null,
      workflowRunId: outcome.workflowRunId ?? null,
    })
    .where(and(scoped(environmentId, id), eq(workflowTriggerDeliveries.status, 'pending')))
    .returning();
  return row ?? null;
}

/** C118.1: pending past `event-retention-days` becomes `expired` and stops holding its event. */
export async function expireWorkflowDeliveries(
  db: Db,
  options: { limit: number; now: Date },
): Promise<number> {
  const at = options.now.toISOString();
  const days = sql`coalesce(
    (${environments.settings} ->> 'event-retention-days')::integer,
    ${DEFAULT_RETENTION['event-retention-days']}::integer)`;
  const due = db
    .select({ id: workflowTriggerDeliveries.id })
    .from(workflowTriggerDeliveries)
    .innerJoin(environments, eq(environments.id, workflowTriggerDeliveries.environmentId))
    .where(
      and(
        eq(workflowTriggerDeliveries.status, 'pending'),
        sql`${workflowTriggerDeliveries.createdAt} < ${at}::timestamptz - make_interval(days => ${days})`,
      ),
    )
    .orderBy(asc(workflowTriggerDeliveries.createdAt))
    .limit(options.limit)
    .for('update', { of: workflowTriggerDeliveries, skipLocked: true });
  const rows = await db
    .update(workflowTriggerDeliveries)
    .set({ status: 'expired', reasonCode: 'event_retention_passed' })
    .where(inArray(workflowTriggerDeliveries.id, due))
    .returning({ id: workflowTriggerDeliveries.id });
  return rows.length;
}

/** `created_at DESC, id DESC` (C1). */
export async function listWorkflowDeliveries(
  db: Db,
  environmentId: string,
  filters: WorkflowDeliveryFilters,
  page: PageRequest,
): Promise<Page<WorkflowTriggerDeliveryRow>> {
  const { workflowIds, statuses } = filters;
  const where = and(
    eq(workflowTriggerDeliveries.environmentId, environmentId),
    workflowIds === undefined
      ? undefined
      : inArray(workflowTriggerDeliveries.workflowId, [...workflowIds]),
    statuses === undefined ? undefined : inArray(workflowTriggerDeliveries.status, [...statuses]),
  );
  const cursor = environmentCursor(workflowTriggerDeliveries);
  return paginate(db, cursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(workflowTriggerDeliveries)
      .where(and(where, after))
      .orderBy(...newestFirst(cursor))
      .limit(limit),
  );
}

/**
 * C118.8: the workflows in a run's causal chain, itself included: back through the event that
 * started it, its parent run, or the run that scheduled it. A walk stops at an event retention has
 * deleted; `trigger_depth` still rises along the chain, so a loop ends at its cap whatever this finds.
 */
export async function listWorkflowCausalChain(
  tx: Db,
  environmentId: string,
  runId: string,
): Promise<string[]> {
  const result = await tx.execute(sql`
    with recursive chain as (
      select r.id, r.workflow_id, r.trigger_delivery_id, r.parent_run_id, r.scheduled_run_id, 1 as hop
        from workflow_runs r
       where r.environment_id = ${environmentId} and r.id = ${runId}
      union
      select r.id, r.workflow_id, r.trigger_delivery_id, r.parent_run_id, r.scheduled_run_id, c.hop + 1
        from chain c
        left join workflow_trigger_deliveries d
          on d.environment_id = ${environmentId} and d.id = c.trigger_delivery_id
        left join events e
          on e.environment_id = ${environmentId} and e.id = d.event_id
        left join scheduled_runs s
          on s.environment_id = ${environmentId} and s.id = c.scheduled_run_id
        join workflow_runs r
          on r.environment_id = ${environmentId}
         and r.id = coalesce(e.caused_by_run_id, c.parent_run_id, s.source_run_id)
       where c.hop < ${CHAIN_LIMIT}
    )
    select distinct workflow_id from chain`);
  const { rows } = result as { rows: { workflow_id: string }[] };
  return rows.map((row) => row.workflow_id);
}
