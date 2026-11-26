/**
 * C112.7, C120.1, C120.2: a run as the API and its events show it. An event carries ids, status,
 * version, rollout label and outcome counts, never a value: every value member is `null` here.
 */
import {
  buildWorkflowRunResource,
  type WorkflowRunCreator,
  type WorkflowRunError,
  type WorkflowRunErroredStep,
  type WorkflowRunRecord,
  type WorkflowRunStepOutcomes,
} from '@openverify/contracts';
import type { WORKFLOW_RUN_CREATOR_TYPES, WorkflowRunStatus } from '@openverify/core';
import { listWorkflowRunSubjectIds, type Db, type WorkflowRunRow } from '@openverify/db';
import type { WorkflowDefinition } from '@openverify/contracts';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';

/** C120.2: a type's fixed text; `message` never carries a value (public rule). */
const FIXED_TEXT: Readonly<Record<string, string>> = {
  'resource-error': 'A resource the run needed failed.',
  'unknown-error': 'The run stopped on an unexpected error.',
  'run-failure': 'The run stopped at a limit.',
};

/** C120.2: configuration and input errors name their code, which is never a value. */
export function runErrorOf(
  run: Pick<WorkflowRunRow, 'errorType' | 'errorCode'>,
): WorkflowRunError | null {
  const { errorType: type, errorCode: code } = run;
  if (type === null) {
    return null;
  }
  return { type, message: FIXED_TEXT[type] ?? `The step failed with ${code ?? 'an error'}.` };
}

/** C120.2: the step a run errored on, from its definition; definitions hold no subject data. */
export function erroredStepOf(
  run: Pick<WorkflowRunRow, 'errorNodeId'>,
  definition: WorkflowDefinition | null,
): WorkflowRunErroredStep | null {
  const step = definition?.steps.find(({ id }) => id === run.errorNodeId);
  if (step === undefined) {
    return null;
  }
  return {
    name: step.name,
    key: step.id,
    type: step.type,
    'action-key': step.type === 'action' ? step['action-key'] : null,
  };
}

type WorkflowRunCreatorType = (typeof WORKFLOW_RUN_CREATOR_TYPES)[number];

/** Every creator a run row may hold, so a new one fails the typecheck until it is named here. */
const CREATORS: Readonly<Record<WorkflowRunCreatorType, WorkflowRunCreator['type']>> = {
  user: 'user',
  'api-key': 'api-key',
  event: 'event',
  'scheduled-run': 'scheduled-run',
  'workflow-run': 'workflow-run',
  'account-action': 'account-action',
  'case-action': 'case-action',
  // C152.2 (Workflow 9A): a flow's run_workflow step, named by its inquiry.
  'inquiry-flow': 'inquiry-flow',
};

const isCreatorType = (type: string): type is WorkflowRunCreatorType =>
  Object.hasOwn(CREATORS, type);

export function creatorOf(run: WorkflowRunRow): WorkflowRunCreator | null {
  const type =
    run.creatorType === null || !isCreatorType(run.creatorType)
      ? undefined
      : CREATORS[run.creatorType];
  return type === undefined || run.creatorId === null ? null : { type, id: run.creatorId };
}

const seconds = (run: WorkflowRunRow): number | null =>
  run.completedAt === null
    ? null
    : Math.max(0, (run.completedAt.getTime() - run.createdAt.getTime()) / 1_000);

/** The record of a run with no value in it; the read routes fill what the reader may see. */
export function runRecordOf(
  run: WorkflowRunRow,
  subjectIds: readonly string[],
  definition: WorkflowDefinition | null,
): WorkflowRunRecord {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    waitingOn: run.waitingOn,
    rolloutLabel: run.rolloutLabel,
    triggerType: run.triggerType,
    error: runErrorOf(run),
    erroredStep: erroredStepOf(run, definition),
    subjectIds,
    stepOutcomes: run.stepOutcomes as WorkflowRunStepOutcomes,
    testRunId: run.isTestRun ? run.id : null,
    overriddenSteps: run.overriddenSteps,
    redactedAt: run.redactedAt,
    valuesPurgedAt: run.valuesPurgedAt,
    inputs: null,
    variables: null,
    outputs: null,
    triggerSnapshot: null,
    creator: creatorOf(run),
    rerunOf: run.rerunOfId,
    processingTimeSeconds: seconds(run),
  };
}

const EVENT_OF: Readonly<
  Record<
    WorkflowRunStatus,
    'workflow-run.completed' | 'workflow-run.errored' | 'workflow-run.canceled' | null
  >
> = {
  in_progress: null,
  completed: 'workflow-run.completed',
  errored: 'workflow-run.errored',
  canceled: 'workflow-run.canceled',
};

type RunEventName =
  | 'workflow-run.created'
  | 'workflow-run.resumed'
  | 'workflow-run.completed'
  | 'workflow-run.errored'
  | 'workflow-run.canceled';

/** Stages one run event; the engine's own events never trigger a workflow (C118.8). */
export async function stageRunEvent(
  tx: Db,
  events: TransactionalEventPublisher,
  run: WorkflowRunRow,
  name: RunEventName,
  definition: WorkflowDefinition | null,
  context: Record<string, unknown> = {},
): Promise<StagedEvent> {
  const subjects = await listWorkflowRunSubjectIds(tx, run.environmentId, [run.id]);
  const data = buildWorkflowRunResource(runRecordOf(run, subjects.get(run.id) ?? [], definition));
  return events.stage(tx, {
    environmentId: run.environmentId,
    name,
    payload: { data, meta: { context } },
  });
}

/** C120.2: the event of a run that just ended. */
export async function stageRunEnd(
  tx: Db,
  events: TransactionalEventPublisher,
  run: WorkflowRunRow,
  definition: WorkflowDefinition | null,
  outputNames: readonly string[],
): Promise<StagedEvent | null> {
  const name = EVENT_OF[run.status];
  if (name === null) {
    return null;
  }
  const error = runErrorOf(run);
  const context =
    name === 'workflow-run.errored' && error !== null
      ? { 'errored-step': erroredStepOf(run, definition), error }
      : name === 'workflow-run.completed'
        ? { 'output-names': [...outputNames] }
        : {};
  return stageRunEvent(tx, events, run, name, definition, context);
}
