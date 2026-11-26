/**
 * C118.1, C118.8, C114.6: the `workflow-trigger` processor, the worker's half of a delivery. Owner:
 * `api-triggers`. Under the delivery's row lock it reads the workflow and the event, decides, and
 * either starts the run in that transaction or marks why not, so a repeated job finds a finished
 * delivery and does nothing. Exactly one of `run_created`, `filtered`, `refused` or `expired` ends a
 * delivery. Only a rate guard leaves one pending, with a `not_before` the sweep honours (C117.8).
 *
 * The criteria run here, never inside `stage()` (C118.1). An unknown never reads as false: each
 * `on-null` is followed, and a condition that errors refuses the delivery with its code.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { matchesWebhookFilters, type WebhookFilters } from '@openverify/core';
import {
  deferWorkflowDelivery,
  finishWorkflowDelivery,
  getEvent,
  getWorkflowLiveTarget,
  getWorkflowRun,
  getWorkflowVersionLiveAt,
  listEventWorkflowTriggers,
  listWorkflowCausalChain,
  lockWorkflowDelivery,
  subjectIdsIn,
  type Db,
  type WorkflowDeliveryOutcome,
  type WorkflowLiveTarget,
  type WorkflowRunRow,
  type WorkflowTriggerDeliveryRow,
} from '@openverify/db';
import {
  WORKFLOW_RUN_LIMITS,
  decideTrigger,
  parseCondition,
  type Expression,
  type JsonRecord,
  type TriggerDocument,
} from '@openverify/workflow-engine';
import { eventFilterSubjects } from '../../events/subject.js';
import type { WorkflowTriggerJob } from '../../ports.js';
import {
  startWorkflowRunInTx,
  wakeStartedRun,
  type StartedWorkflowRun,
} from '../engine/start-run.js';
import { engineDepsOf } from '../engine/worker-deps.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { deferredUntil, runGuard, subjectGuard } from './admission.js';
import { isRedactedDocument, snapshotFits, triggerViewOf } from './objects.js';
import { chooseRolloutVersion } from './rollout.js';
import { readRunTarget, type RunTarget } from './start-target.js';

const FILTER_KEYS = [
  'inquiry-template-ids',
  'account-type-ids',
  'workflow-ids',
  'list-ids',
  // C143.4 (Workflow 8B).
  'case-template-ids',
] as const;

type Outcome = WorkflowDeliveryOutcome;

const refused = (reasonCode: string): Outcome => ({ status: 'refused', reasonCode });
const filtered = (reasonCode: string): Outcome => ({ status: 'filtered', reasonCode });

/** What a transaction ends with. */
type Decision = Outcome | { defer: Date } | { started: StartedWorkflowRun; runId: string };

/** The webhook filter keys of an index row's `filter`, or `null` when it holds none (outcome 29). */
function subjectFilterOf(filter: Readonly<Record<string, unknown>> | null): WebhookFilters | null {
  const held = FILTER_KEYS.filter((key) => Array.isArray(filter?.[key]));
  return filter === null || held.length === 0
    ? null
    : Object.fromEntries(held.map((key) => [key, filter[key]]));
}

/** The events a definition's trigger listens to, or `null` for a trigger no event starts. */
function eventTriggerOf(definition: WorkflowDefinition) {
  const { trigger } = definition;
  return trigger?.type === 'trigger-event' || trigger?.type === 'trigger-verification'
    ? trigger
    : null;
}

/** C116.3, C118.1: the version this event starts: its subject's side, never newer than the event. */
async function chooseTarget(
  tx: Db,
  environmentId: string,
  workflowId: string,
  live: WorkflowLiveTarget,
  subjectId: string,
  eventAt: Date,
): Promise<RunTarget | Outcome> {
  const choice = chooseRolloutVersion(live.version, live.deployment, live.versions, subjectId);
  if (choice === null) {
    return refused('workflow_not_running');
  }
  const { publishedAt } = choice.version;
  if (publishedAt !== null && publishedAt <= eventAt) {
    return (
      readRunTarget(choice.version, choice.deploymentId, choice.label) ??
      refused('definition_unreadable')
    );
  }
  const earlier = await getWorkflowVersionLiveAt(tx, environmentId, workflowId, eventAt);
  if (earlier === null) {
    return refused('event_before_activation');
  }
  return readRunTarget(earlier, null, null) ?? refused('definition_unreadable');
}

/** C118.1, C114.6: whether the trigger admits this event. */
async function admission(
  tx: Db,
  deps: WorkflowWorkerDeps,
  delivery: WorkflowTriggerDeliveryRow,
  target: RunTarget,
  document: TriggerDocument,
  view: JsonRecord,
): Promise<Outcome | null> {
  const { environmentId, workflowId, eventName } = delivery;
  const trigger = eventTriggerOf(target.definition);
  if (trigger === null || !(trigger.config.events as readonly string[]).includes(eventName)) {
    return refused('event_not_listened');
  }
  if (trigger.type === 'trigger-verification') {
    const types = trigger.config['verification-types'] as readonly string[] | undefined;
    if (types !== undefined && !types.includes(document.data.type)) {
      return filtered('verification_type_not_listed');
    }
  }
  const rows = await listEventWorkflowTriggers(tx, environmentId, eventName);
  const filters = subjectFilterOf(
    rows.find((row) => row.workflowId === workflowId)?.filter ?? null,
  );
  if (filters !== null) {
    const payload = document as unknown;
    const [subject] = await eventFilterSubjects(tx, environmentId, [payload]);
    if (!matchesWebhookFilters({ payload, ...(subject ? { subject } : {}) }, filters)) {
      return filtered('subject_filter_not_met');
    }
  }
  return criteriaOutcome(trigger.config.criteria, trigger.config['on-null'], view, deps);
}

function criteriaOutcome(
  criteria: unknown,
  onNull: string | undefined,
  view: JsonRecord,
  deps: WorkflowWorkerDeps,
): Outcome | null {
  let expression: Expression | null = null;
  if (criteria !== undefined) {
    const parsed = parseCondition(criteria);
    if (!parsed.ok) {
      return refused('criteria_invalid');
    }
    expression = parsed.expression;
  }
  const decision = decideTrigger(expression, onNull ?? null, {
    roots: { trigger: view },
    now: deps.clock.now().toISOString(),
  });
  switch (decision.kind) {
    case 'admit':
      return null;
    case 'filtered':
      return filtered(decision.reason === 'criteria' ? 'criteria_not_met' : 'criteria_null');
    case 'error':
      return refused(decision.code);
  }
}

interface Lineage {
  triggerDepth: number;
  rootRunId: string | null;
  causedByPrincipal: string | null;
}

/** C118.8, C121.3: where a run stands in its causal chain, or why it may not start. */
async function lineageOf(
  tx: Db,
  environmentId: string,
  workflowId: string,
  target: RunTarget,
  event: { causedByRunId: string | null; causedByPrincipal: string | null },
): Promise<Lineage | Outcome> {
  if (event.causedByRunId === null) {
    return { triggerDepth: 0, rootRunId: null, causedByPrincipal: event.causedByPrincipal };
  }
  const cause: WorkflowRunRow | null = await getWorkflowRun(tx, environmentId, event.causedByRunId);
  if (cause === null) {
    return refused('trigger_cause_missing');
  }
  const triggerDepth = cause.triggerDepth + 1;
  if (triggerDepth > WORKFLOW_RUN_LIMITS['trigger-depth'].value) {
    return refused('trigger_depth_exceeded');
  }
  const chain = await listWorkflowCausalChain(tx, environmentId, cause.id);
  if (chain.includes(workflowId) && target.definition.trigger?.['allow-self-trigger'] !== true) {
    return refused('trigger_cycle');
  }
  return {
    triggerDepth,
    rootRunId: cause.rootRunId ?? cause.id,
    causedByPrincipal: cause.causedByPrincipal ?? event.causedByPrincipal,
  };
}

const isOutcome = (value: object): value is Outcome => 'status' in value;

async function decide(
  tx: Db,
  deps: WorkflowWorkerDeps,
  delivery: WorkflowTriggerDeliveryRow,
): Promise<Decision> {
  const { environmentId, workflowId, id } = delivery;
  const event = await getEvent(tx, environmentId, delivery.eventId);
  if (event === null) {
    return { status: 'expired', reasonCode: 'event_missing' };
  }
  const live = await getWorkflowLiveTarget(tx, environmentId, workflowId);
  if (live?.workflow.status !== 'running') {
    return refused('workflow_not_running');
  }
  const document = event.payload as unknown as TriggerDocument;
  if (isRedactedDocument(document)) {
    return refused('subject_redacted');
  }
  const subjectId = document.data.id;
  const target = await chooseTarget(
    tx,
    environmentId,
    workflowId,
    live,
    subjectId,
    event.createdAt,
  );
  if (isOutcome(target)) {
    return target;
  }
  const view = await triggerViewOf(tx, environmentId, target.definition, document);
  const refusal = await admission(tx, deps, delivery, target, document, view);
  if (refusal !== null) {
    return refusal;
  }
  const lineage = await lineageOf(tx, environmentId, workflowId, target, {
    causedByRunId: event.causedByRunId,
    causedByPrincipal: event.causedByPrincipal,
  });
  if (isOutcome(lineage)) {
    return lineage;
  }
  if (!snapshotFits(view)) {
    return refused('payload_too_large');
  }
  const notBefore = await deferredUntil(deps.services.rateLimiter, deps.clock.now(), [
    subjectGuard(workflowId, subjectId),
    runGuard(environmentId),
  ]);
  if (notBefore !== null) {
    return { defer: notBefore };
  }
  const { definition, grant, version, deploymentId, rolloutLabel } = target;
  const started = await startWorkflowRunInTx(tx, engineDepsOf(deps), {
    environmentId,
    workflowId,
    workflowVersionId: version.id,
    deploymentId,
    rolloutLabel,
    triggerType: eventTriggerOf(definition)?.type ?? 'trigger-event',
    triggerDeliveryId: id,
    creator: { type: 'event', id: event.id },
    trigger: view,
    inputs: {},
    subjectIds: subjectIdsIn(event.payload, subjectId),
    grant,
    ...lineage,
    oneRunPerSubject: definition.trigger?.['one-run-per-subject'] === true ? subjectId : null,
  });
  return { started, runId: started.run.id };
}

export async function processWorkflowTrigger(
  job: WorkflowTriggerJob,
  deps: WorkflowWorkerDeps,
): Promise<void> {
  const { environmentId, deliveryId } = job;
  const started = await deps.db.transaction(async (tx) => {
    const delivery = await lockWorkflowDelivery(tx, environmentId, deliveryId);
    const now = deps.clock.now();
    if (
      delivery?.status !== 'pending' ||
      (delivery.notBefore !== null && delivery.notBefore > now)
    ) {
      return null;
    }
    const decision = await decide(tx, deps, delivery);
    if ('defer' in decision) {
      await deferWorkflowDelivery(tx, environmentId, deliveryId, decision.defer);
      return null;
    }
    if ('started' in decision) {
      await finishWorkflowDelivery(tx, environmentId, deliveryId, {
        status: 'run_created',
        workflowRunId: decision.runId,
      });
      return decision.started;
    }
    await finishWorkflowDelivery(tx, environmentId, deliveryId, decision);
    deps.logger.info(
      { deliveryId, workflowId: delivery.workflowId, status: decision.status },
      `workflow delivery ${decision.reasonCode ?? decision.status}`,
    );
    return null;
  });
  if (started?.created === true) {
    await wakeStartedRun(engineDepsOf(deps), started);
  }
}
