/**
 * C118.1: what `stage()` calls for an event trigger. Owner: `api-triggers`. It reads
 * `workflow_triggers` with one indexed lookup and writes one `workflow_trigger_deliveries` row per
 * match, `ON CONFLICT (event_id, workflow_id) DO NOTHING`, in the event's own transaction, and returns
 * the jobs to enqueue after the commit. It never evaluates a condition: criteria are the worker's, so
 * an operator's rule can never slow or fail a transition.
 *
 * `workflow-run.*` and `workflow*.published` events start nothing (C118.8), and neither do a test
 * run's events unless its request opted in (C120.7). A simulated webhook event never comes here: it
 * is written by `createEvent` directly, not through `stage()`. Past the 50 workflows an event may
 * start (C117.7), a delivery is written `refused`, so `GET /workflow-trigger-deliveries` lists it.
 */
import { isEventName, isTriggerableEvent } from '@openverify/contracts';
import {
  createWorkflowDeliveries,
  listEventWorkflowTriggers,
  type Db,
  type EventCause,
  type NewWorkflowDelivery,
} from '@openverify/db';
import { WORKFLOW_RUN_LIMITS } from '@openverify/workflow-engine';
import { ulidIdGenerator, type WorkflowTriggerJob } from '../../ports.js';

/** C117.7: the code of the delivery past the cap. */
export const TRIGGER_FANOUT_EXCEEDED = 'trigger_fanout_exceeded';

/**
 * C120.7: a test run's cause, with the request's opt-in. The test-run executor passes it to
 * `runWithEventCause`; it stays in memory, because a run records its own `allow-triggers`.
 */
export interface TriggerEventCause extends EventCause {
  testRunAllowsTriggers?: boolean | undefined;
}

export interface StagedEventFacts {
  environmentId: string;
  eventId: string;
  name: string;
  payload: unknown;
  cause: TriggerEventCause | undefined;
}

/** Whether an event of this name and cause may start a run at all. */
function canTrigger({ name, cause }: StagedEventFacts): boolean {
  if (!isEventName(name) || !isTriggerableEvent(name)) {
    return false;
  }
  return cause?.testRunId === undefined || cause.testRunId === null
    ? true
    : cause.testRunAllowsTriggers === true;
}

export async function stageWorkflowTriggersInTx(
  tx: Db,
  event: StagedEventFacts,
): Promise<WorkflowTriggerJob[]> {
  if (!canTrigger(event)) {
    return [];
  }
  const { environmentId, eventId, name } = event;
  const triggers = await listEventWorkflowTriggers(tx, environmentId, name);
  if (triggers.length === 0) {
    return [];
  }
  const cap = WORKFLOW_RUN_LIMITS['event-fanout'].value;
  const workflowIds = [...new Set(triggers.map((trigger) => trigger.workflowId))];
  const deliveries = workflowIds.map((workflowId, index): NewWorkflowDelivery => ({
    id: ulidIdGenerator.newId('wftd'),
    eventId,
    eventName: name,
    workflowId,
    ...(index < cap ? {} : { status: 'refused', reasonCode: TRIGGER_FANOUT_EXCEEDED }),
  }));
  const written = await createWorkflowDeliveries(tx, environmentId, deliveries);
  return written
    .filter((delivery) => delivery.status === 'pending')
    .map((delivery) => ({ environmentId, deliveryId: delivery.id }));
}
