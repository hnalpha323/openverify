/**
 * C120, C118: how every run starts. `api-triggers` (event, API, manual, scheduled, recurring and
 * account starts), rerun, test runs and Run Workflow call {@link startWorkflowRunInTx} in their
 * transaction, then {@link wakeStartedRun} after the commit.
 *
 * A start is idempotent on its key: a delivery, a schedule fire, a scheduled run or an idempotency key
 * that already made a run answers that run, with `created: false`, and nothing happens twice.
 */
import type { WorkflowRolloutLabel, WorkflowTriggerType } from '@openverify/core';
import {
  appendWorkflowJournal,
  createWorkflowRun,
  findEarlierWorkflowRun,
  getEnvironment,
  recordWorkflowRunSubjects,
  saveWorkflowRunWaiter,
  type Db,
  type WorkflowRunRow,
} from '@openverify/db';
import { WORKFLOW_RUN_LIMITS, type JsonRecord, type JsonValue } from '@openverify/workflow-engine';
import type { RunGrant } from './action-port.js';
import { beginRun, emptyAfterCommit, flushAfterCommit, type AfterCommit } from './advance-run.js';
import { databaseNow, type EngineDeps } from './deps.js';
import { stageRunEvent } from './run-events.js';
import { definitionOf, newFrame, type TestRunOptions } from './run-frame.js';

/** C120.1. */
export interface RunCreator {
  readonly type: string;
  readonly id: string;
}

export interface StartWorkflowRunInput {
  readonly environmentId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly deploymentId?: string | null;
  readonly rolloutLabel?: WorkflowRolloutLabel | null;
  readonly triggerType: WorkflowTriggerType;
  /** Each way of starting has its key, and a repeat answers the run it made (C118). */
  readonly triggerDeliveryId?: string | null;
  readonly scheduleFire?: string | null;
  readonly scheduledRunId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly creator: RunCreator | null;
  /** The flattened trigger view (C114.4), snapshotted with what the version's paths need. */
  readonly trigger: JsonValue;
  readonly inputs: JsonRecord;
  /** C120.9: the ids the run was started for. */
  readonly subjectIds: readonly string[];
  /** C121.3: the principal that caused this run's root; `null` for the flow and system jobs. */
  readonly causedByPrincipal?: string | null;
  /** C121.3: the version's grant, narrowed by the principal who started the root. */
  readonly grant: RunGrant;
  readonly rootRunId?: string | null;
  readonly parentRunId?: string | null;
  readonly rerunOfId?: string | null;
  readonly depth?: number;
  /** C118.8: the cause's plus one. */
  readonly triggerDepth?: number;
  /** C118.9: the subject a `one-run-per-subject` workflow serialises on. */
  readonly oneRunPerSubject?: string | null;
  /** C120.7: only `createWorkflowTestRun` sets this. */
  readonly test?: TestRunOptions & { readonly startStep?: string | null };
}

export interface StartedWorkflowRun {
  readonly run: WorkflowRunRow;
  /** False when a key found the run an earlier start made: nothing new happened. */
  readonly created: boolean;
  /** Run `wakeStartedRun` with this after the commit. */
  readonly after: AfterCommit;
}

const RUN_SECONDS = WORKFLOW_RUN_LIMITS['run-duration-seconds'].value;
const SNAPSHOT_BYTES = WORKFLOW_RUN_LIMITS['trigger-snapshot-bytes'].value;

const currentRunOf = (
  id: string,
  input: StartWorkflowRunInput,
  kind: string | null,
): JsonRecord => ({
  id,
  'workflow-id': input.workflowId,
  'version-id': input.workflowVersionId,
  environment: { kind },
});

export async function startWorkflowRunInTx(
  tx: Db,
  deps: EngineDeps,
  input: StartWorkflowRunInput,
): Promise<StartedWorkflowRun> {
  const { environmentId } = input;
  const definition = await definitionOf(tx, environmentId, input.workflowVersionId);
  if (definition === null) {
    throw new Error('a run’s version is not in its environment');
  }
  const id = deps.ids.newId('wfr');
  const now = await databaseNow(tx);
  const kind = (await getEnvironment(tx, environmentId))?.kind ?? null;
  const defaults = Object.fromEntries(
    definition.variables.flatMap(({ name, default: value }) =>
      value === undefined ? [] : [[name, value]],
    ),
  ) as JsonRecord;
  const { test = null } = input;
  const frame = newFrame(defaults, currentRunOf(id, input, kind), test);
  const oversized = Buffer.byteLength(JSON.stringify(input.trigger), 'utf8') > SNAPSHOT_BYTES;
  const run = await createWorkflowRun(tx, environmentId, {
    id,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    workflowDeploymentId: input.deploymentId,
    rolloutLabel: input.rolloutLabel,
    triggerType: input.triggerType,
    triggerDeliveryId: input.triggerDeliveryId,
    scheduleFire: input.scheduleFire,
    scheduledRunId: input.scheduledRunId,
    idempotencyKey: input.idempotencyKey,
    creatorType: input.creator?.type ?? null,
    creatorId: input.creator?.id ?? null,
    rootRunId: input.rootRunId ?? id,
    parentRunId: input.parentRunId,
    rerunOfId: input.rerunOfId,
    depth: input.depth,
    triggerDepth: input.triggerDepth,
    deadlineAt: new Date(now.getTime() + RUN_SECONDS * 1_000),
    causedByPrincipal: input.causedByPrincipal,
    effectiveGrant: { scopes: [...input.grant.scopes], pii: input.grant.pii },
    isTestRun: test !== null,
    overriddenSteps: test === null ? [] : Object.keys(test.overrides),
    triggerSnapshot: oversized ? null : (input.trigger as Record<string, unknown> | null),
    inputs: input.inputs,
    variables: frame as unknown as Record<string, unknown>,
  });
  const after = emptyAfterCommit();
  if (run.id !== id) {
    return { run, created: false, after };
  }
  await recordWorkflowRunSubjects(
    tx,
    environmentId,
    id,
    input.subjectIds.map((subjectId) => ({ subjectId, source: 'trigger' as const })),
  );
  await appendWorkflowJournal(tx, environmentId, [{ runId: id, kind: 'run_created' }]);
  after.staged.push(await stageRunEvent(tx, deps.events, run, 'workflow-run.created', definition));
  after.environments.add(environmentId);
  if (input.oneRunPerSubject != null) {
    const earlier = await findEarlierWorkflowRun(tx, environmentId, {
      workflowId: input.workflowId,
      subjectId: input.oneRunPerSubject,
      runId: id,
    });
    if (earlier !== null) {
      const held = await saveWorkflowRunWaiter(tx, environmentId, id, earlier.id);
      return { run: held ?? run, created: true, after };
    }
  }
  await beginRun(tx, deps, run, frame, after, test?.startStep ?? null);
  return { run, created: true, after };
}

/** After the commit: dispatches the run's events and enqueues its first steps. */
export async function wakeStartedRun(
  deps: EngineDeps,
  started: Pick<StartedWorkflowRun, 'after'>,
): Promise<void> {
  await flushAfterCommit(deps, started.after);
}
