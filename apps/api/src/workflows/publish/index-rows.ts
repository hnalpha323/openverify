/**
 * What a published version writes to the indexes the event path reads: the trigger rows of C118.1,
 * the waited events of C119.3 and the schedule of C118.4. Each is computed from the definition alone,
 * so an index can never say something its version does not.
 */
import {
  REPORT_EVENT_NAMES,
  type EventName,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@openverify/contracts';
import { WORKFLOW_DEFINITION_LIMITS } from '@openverify/core';
import type { NewWorkflowSchedule, NewWorkflowTrigger } from '@openverify/db';
import { nextFireTime } from '@openverify/workflow-engine';

export type TriggerTarget = { versionId: string } | { deploymentId: string };

type Trigger = NonNullable<WorkflowDefinition['trigger']>;

/**
 * C118.1: everything but the event names, and `null` for a trigger that filters nothing. The subject
 * filter's keys (K8-10) are written at the top, where the worker reads the webhook filter keys.
 */
function filterOf(config: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const members = Object.entries(config).flatMap(([key, value]): [string, unknown][] => {
    if (key === 'events') {
      return [];
    }
    if (key === 'filter' && typeof value === 'object' && value !== null) {
      return Object.entries(value);
    }
    return [[key, value]];
  });
  return members.length === 0 ? null : Object.fromEntries(members);
}

function targetColumns(target: TriggerTarget) {
  return 'versionId' in target
    ? { workflowVersionId: target.versionId }
    : { workflowDeploymentId: target.deploymentId };
}

export function triggerIndexRows(
  definition: WorkflowDefinition,
  target: TriggerTarget,
): NewWorkflowTrigger[] {
  const { trigger } = definition;
  if (trigger === null) {
    return [];
  }
  const columns = targetColumns(target);
  if (trigger.type === 'trigger-event' || trigger.type === 'trigger-verification') {
    const filter = filterOf(trigger.config);
    return trigger.config.events.map((eventName) => ({
      kind: trigger.type,
      eventName,
      ...columns,
      filter,
    }));
  }
  return [{ kind: trigger.type, eventName: null, ...columns, filter: null }];
}

const REPORT_TERMINAL_EVENTS: readonly EventName[] = REPORT_EVENT_NAMES.filter(
  (name) => name.endsWith('.ready') || name.endsWith('.errored'),
);

const GRAPH_QUERY_TERMINAL_EVENTS: readonly EventName[] = [
  'graph-query.completed',
  'graph-query.errored',
  'graph-query.timed-out',
  'graph-query.cancelled',
];

const VERIFICATION_TERMINAL_EVENTS: readonly EventName[] = [
  'verification.passed',
  'verification.failed',
];

/** C127.2, C127.3, C127.5: what an action's own wait resolves on, beside `wait` nodes. */
function actionWaitEvents(step: Extract<WorkflowStep, { type: 'action' }>): readonly EventName[] {
  switch (step['action-key']) {
    // `rescreen_account_reports` (K8-7, Workflow 8D, a request of api-carry-engine) waits for each
    // report it reran, as `rerun_report` does.
    case 'run_report':
    case 'rerun_report':
    case 'rescreen_account_reports':
      return REPORT_TERMINAL_EVENTS;
    case 'run_verification':
      return VERIFICATION_TERMINAL_EVENTS;
    case 'run_graph_query':
      return step.config.mode === 'synchronous' ? GRAPH_QUERY_TERMINAL_EVENTS : [];
    default:
      return [];
  }
}

/** C119.3: each event `stage()` must keep a candidate for while this version can wait on it. */
export function waitEventNames(definition: WorkflowDefinition): string[] {
  const names = definition.steps.flatMap((step): readonly string[] => {
    if (step.type === 'wait') {
      return step.mode === 'events' ? step.events : [];
    }
    return step.type === 'action' ? actionWaitEvents(step) : [];
  });
  return [...new Set(names)];
}

const recurringConfig = (trigger: Trigger | null) =>
  trigger?.type === 'trigger-recurring' ? trigger.config : null;

/** C118.4: the schedule of a recurring trigger, firing next after `now`. */
export function scheduleOf(
  definition: WorkflowDefinition,
  input: { id: string; workflowId: string; now: Date },
): NewWorkflowSchedule | null {
  const config = recurringConfig(definition.trigger);
  if (config === null) {
    return null;
  }
  const cron = config.cron ?? null;
  const everyMinutes = config['every-minutes'] ?? null;
  const timeZone = config['time-zone'];
  const nextFireAt = nextFireTime(
    {
      ...(cron === null ? {} : { cron }),
      ...(everyMinutes === null ? {} : { everyMinutes }),
      timeZone,
    },
    input.now.toISOString(),
  );
  const { filter } = config;
  return {
    id: input.id,
    workflowId: input.workflowId,
    cron,
    everyMinutes,
    timeZone,
    objectType: config['object-type'],
    filter: filter === undefined ? null : (filter as Record<string, unknown>),
    onNull: config['on-null'] ?? null,
    batchCap: config['batch-cap'] ?? WORKFLOW_DEFINITION_LIMITS['recurring-batch-default'].value,
    nextFireAt: new Date(nextFireAt),
  };
}
