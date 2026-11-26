/**
 * C117.1, C117.3: an advance of a run, under its lock. It writes what the pure interpreter decided:
 * control-flow nodes' rows, the steps it made ready, waits entered, modules pinned, the state, and the
 * end of a run with its event. A run's lock is held from before the state is read until the commit,
 * because the variables and the counters are read-modify-write.
 */
import {
  WORKFLOW_RUN_LIMITS,
  advance,
  parseCondition,
  startRun,
  stepKey,
  workflowErrorTypeOf,
  type AdvanceResult,
  type ExecutedStep,
  type JsonRecord,
  type JsonValue,
  type ReadyStep,
  type StepCompletion,
} from '@openverify/workflow-engine';
import {
  appendWorkflowJournal,
  cancelWorkflowRunSteps,
  countWorkflowRunStepStates,
  createWorkflowRunSteps,
  endWorkflowRun,
  findWorkflowRunStep,
  getWorkflowRunVersion,
  latestPublishedWorkflowRunVersion,
  listRunsWaitingOnRun,
  openWorkflowRunValues,
  readyWorkflowRunStep,
  saveWorkflowRunState,
  saveWorkflowRunWaiter,
  setWorkflowRunWaitingOn,
  settleWorkflowRunStep,
  type Db,
  type WorkflowJournalEntry,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import type { WorkflowNodeType, WorkflowStepStatus } from '@openverify/core';
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import type { StagedEvent } from '../../events/index.js';
import type { WorkflowStepJob } from '../../ports.js';
import { databaseNow, type EngineDeps } from './deps.js';
import { dispatchEnvironment } from './dispatcher.js';
import {
  definitionAt,
  definitionOf,
  frameOf,
  loadRun,
  packFrame,
  type LoadedRun,
  type RunFrame,
} from './run-frame.js';
import { stageRunEnd } from './run-events.js';
import { enterEventWaitInTx, enterTimeWaitInTx } from './wait-resolution.js';
import { currentCaseValueOf } from '../actions/cases/current-case.js';

/** A step to enqueue after the commit, with a delay when it is due later. */
export interface StepWake {
  readonly job: WorkflowStepJob;
  readonly delayMs?: number;
}

/** What a transaction leaves for after its commit. */
export interface AfterCommit {
  staged: StagedEvent[];
  wakes: StepWake[];
  /** Environments with something new to dispatch. */
  environments: Set<string>;
  tasks: (() => Promise<void>)[];
}

export const emptyAfterCommit = (): AfterCommit => ({
  staged: [],
  wakes: [],
  environments: new Set(),
  tasks: [],
});

type Outcomes = Record<string, number>;

const countOutcome = (outcomes: Outcomes, name: string, by = 1): Outcomes => ({
  ...outcomes,
  [name]: (outcomes[name] ?? 0) + by,
});

export interface AdvanceSession {
  tx: Db;
  deps: EngineDeps;
  loaded: LoadedRun;
  after: AfterCommit;
  now: Date;
  outcomes: Outcomes;
  journal: WorkflowJournalEntry[];
}

export async function openSession(
  tx: Db,
  deps: EngineDeps,
  loaded: LoadedRun,
  after: AfterCommit,
): Promise<AdvanceSession> {
  return {
    tx,
    deps,
    loaded,
    after,
    now: await databaseNow(tx),
    outcomes: { ...loaded.run.stepOutcomes },
    journal: [],
  };
}

const contextOf = (loaded: LoadedRun) => ({
  modules: loaded.modules,
  ...(loaded.frame.test?.endStep == null ? {} : { endStep: loaded.frame.test.endStep }),
});

function stepAt(
  loaded: LoadedRun,
  nodeId: string,
  iterationPath: string,
): WorkflowStep | undefined {
  return definitionAt(loaded, iterationPath).steps.find(({ id }) => id === nodeId);
}

const nodeTypeOf = (step: WorkflowStep | undefined): WorkflowNodeType => step?.type ?? 'action';

const asRecord = (value: JsonValue): JsonRecord | null =>
  value === null ? null : typeof value === 'object' && !Array.isArray(value) ? value : { value };

const STATUS_OF: Readonly<Record<ExecutedStep['status'], WorkflowStepStatus>> = {
  succeeded: 'succeeded',
  failed: 'failed',
  timed_out: 'timed_out',
};

const KIND_OF = {
  succeeded: 'step_succeeded',
  failed: 'step_failed',
  timed_out: 'wait_timed_out',
} as const;

/** The row of a step that ran inside this advance. */
async function recordExecuted(session: AdvanceSession, executed: ExecutedStep): Promise<void> {
  const { tx, loaded, deps, now } = session;
  const { environmentId, id: runId } = loaded.run;
  const { nodeId, iterationPath } = executed;
  const definitionStep = stepAt(loaded, nodeId, iterationPath);
  const existing = await findWorkflowRunStep(tx, environmentId, { runId, nodeId, iterationPath });
  const stepId = existing?.id ?? deps.ids.newId('wfst');
  if (existing === null) {
    await createWorkflowRunSteps(tx, environmentId, [
      {
        id: stepId,
        runId,
        nodeId,
        iterationPath,
        nodeType: nodeTypeOf(definitionStep),
        actionKey: definitionStep?.type === 'action' ? definitionStep['action-key'] : null,
        actionVersion: definitionStep?.type === 'action' ? definitionStep['action-version'] : null,
        status: 'pending',
      },
    ]);
  }
  const errorType = executed.code === null ? null : workflowErrorTypeOf(executed.code);
  await settleWorkflowRunStep(tx, environmentId, {
    stepId,
    status: STATUS_OF[executed.status],
    output: asRecord(executed.output),
    errorType,
    errorCode: executed.code,
    at: now,
  });
  session.journal.push({
    runId,
    kind: KIND_OF[executed.status],
    stepId,
    nodeId,
    iterationPath,
    errorType,
    errorCode: executed.code,
  });
}

function tallyExecuted(
  session: AdvanceSession,
  executed: ExecutedStep,
  result: AdvanceResult,
): void {
  const { nodeId, iterationPath } = executed;
  if (executed.status === 'succeeded') {
    session.outcomes = countOutcome(session.outcomes, 'succeeded');
  } else if (executed.status === 'timed_out') {
    session.outcomes = countOutcome(session.outcomes, 'timed-out');
  } else if (
    !result.nextState.failures.some(
      (failure) => failure.nodeId === nodeId && failure.iterationPath === iterationPath,
    )
  ) {
    session.outcomes = countOutcome(session.outcomes, 'failed-continued');
  }
}

async function readyAction(
  session: AdvanceSession,
  ready: Extract<ReadyStep, { kind: 'action' }>,
): Promise<StepCompletion | null> {
  const { tx, loaded, deps } = session;
  const { environmentId, id: runId } = loaded.run;
  const { nodeId, iterationPath, actionKey, actionVersion } = ready;
  const override = loaded.frame.test?.overrides[nodeId];
  const definitionStep = stepAt(loaded, nodeId, iterationPath);
  const config = definitionStep?.type === 'action' ? definitionStep.config : {};
  const existing = await findWorkflowRunStep(tx, environmentId, { runId, nodeId, iterationPath });
  const stepId = existing?.id ?? deps.ids.newId('wfst');
  if (existing === null) {
    await createWorkflowRunSteps(tx, environmentId, [
      {
        id: stepId,
        runId,
        nodeId,
        iterationPath,
        nodeType: 'action',
        actionKey,
        actionVersion,
        status: 'ready',
        input: config,
      },
    ]);
  } else {
    await readyWorkflowRunStep(tx, environmentId, stepId);
  }
  session.journal.push({ runId, kind: 'step_ready', stepId, nodeId, iterationPath });
  // C120.7: a test run's override stands in for the step, which never runs.
  if (override !== undefined) {
    await settleWorkflowRunStep(tx, environmentId, {
      stepId,
      status: 'succeeded',
      output: asRecord(override),
      overridden: true,
      at: session.now,
    });
    session.journal.push({ runId, kind: 'step_succeeded', stepId, nodeId, iterationPath });
    session.outcomes = countOutcome(session.outcomes, 'succeeded');
    return { kind: 'step', nodeId, iterationPath, outcome: 'succeeded', output: override };
  }
  session.after.environments.add(environmentId);
  return null;
}

async function pendingRow(
  session: AdvanceSession,
  nodeId: string,
  iterationPath: string,
): Promise<WorkflowRunStepRow | null> {
  const { tx, loaded, deps } = session;
  const { environmentId, id: runId } = loaded.run;
  const existing = await findWorkflowRunStep(tx, environmentId, { runId, nodeId, iterationPath });
  if (existing !== null) {
    return existing;
  }
  const [created] = await createWorkflowRunSteps(tx, environmentId, [
    {
      id: deps.ids.newId('wfst'),
      runId,
      nodeId,
      iterationPath,
      nodeType: nodeTypeOf(stepAt(loaded, nodeId, iterationPath)),
      status: 'pending',
    },
  ]);
  return created ?? null;
}

/** C119.8: the module's version is pinned when the step starts, and recorded. */
async function startModule(
  session: AdvanceSession,
  ready: Extract<ReadyStep, { kind: 'module' }>,
): Promise<StepCompletion> {
  const { tx, loaded } = session;
  const { environmentId } = loaded.run;
  const { nodeId, iterationPath, moduleWorkflowId, version } = ready;
  await pendingRow(session, nodeId, iterationPath);
  const pinned =
    version === 'latest-published'
      ? await latestPublishedWorkflowRunVersion(tx, environmentId, moduleWorkflowId)
      : await getWorkflowRunVersion(tx, environmentId, version);
  const definition: WorkflowDefinition | null =
    pinned === null ? null : await definitionOf(tx, environmentId, pinned.id);
  if (pinned === null || definition === null) {
    return { kind: 'step', nodeId, iterationPath, outcome: 'failed', code: 'execution_error' };
  }
  const path = `${iterationPath}module:${nodeId}/`;
  loaded.modules[path] = definition;
  loaded.frame = {
    ...loaded.frame,
    moduleVersions: { ...loaded.frame.moduleVersions, [path]: pinned.id },
  };
  return { kind: 'module-started', nodeId, iterationPath };
}

async function makeReady(
  session: AdvanceSession,
  ready: ReadyStep,
): Promise<StepCompletion | null> {
  switch (ready.kind) {
    case 'action':
      return readyAction(session, ready);
    case 'module':
      return startModule(session, ready);
    case 'wait-time': {
      const row = await pendingRow(session, ready.nodeId, ready.iterationPath);
      if (row !== null) {
        await enterTimeWaitInTx(session, row, ready.seconds);
      }
      return null;
    }
    case 'wait-events': {
      const row = await pendingRow(session, ready.nodeId, ready.iterationPath);
      const step = stepAt(session.loaded, ready.nodeId, ready.iterationPath);
      if (row !== null) {
        const filter = step?.type === 'wait' && step.mode === 'events' ? step.filter : undefined;
        const parsed = filter === undefined ? null : parseCondition(filter);
        if (parsed?.ok === false) {
          return {
            kind: 'step',
            nodeId: ready.nodeId,
            iterationPath: ready.iterationPath,
            outcome: 'failed',
            code: 'execution_error',
          };
        }
        await enterEventWaitInTx(session, row, {
          correlationKey: ready.correlationKey,
          events: ready.events,
          timeoutSeconds: ready.timeoutSeconds,
          filter: filter ?? null,
          onNull:
            step?.type === 'wait' && step.mode === 'events' ? (step['on-null'] ?? null) : null,
        });
      }
      return null;
    }
  }
}

/** Plays out a result: rows, then ready steps, then whatever those completed at once. */
async function settle(
  session: AdvanceSession,
  first: AdvanceResult,
  done: string | null,
): Promise<void> {
  const { loaded } = session;
  const pending: { result: AdvanceResult; done: string | null }[] = [{ result: first, done }];
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const { result } = next;
    loaded.state = result.nextState;
    for (const executed of result.executed) {
      tallyExecuted(session, executed, result);
      if (stepKey(executed.iterationPath, executed.nodeId) !== next.done) {
        await recordExecuted(session, executed);
      }
    }
    for (const ready of result.stepsToMakeReady) {
      const completion = await makeReady(session, ready);
      if (completion !== null) {
        const key =
          completion.kind === 'step' ? stepKey(completion.iterationPath, completion.nodeId) : null;
        pending.push({
          result: advance(loaded.definition, loaded.state, completion, contextOf(loaded)),
          done: key,
        });
      }
    }
  }
}

/** C117.7: the run stopped as a whole, or at a step nothing absorbed. */
function failureOf(loaded: LoadedRun): { code: string; nodeId: string | null } {
  const [failure] = loaded.state.failures;
  return failure === undefined
    ? { code: 'execution_error', nodeId: null }
    : { code: failure.code, nodeId: failure.nodeId };
}

/** C118.9: the next run of this workflow and subject stops waiting, and starts. */
export async function releaseEarlierRunWaiters(
  session: AdvanceSession,
  run: WorkflowRunRow,
): Promise<void> {
  const { tx, deps, after } = session;
  const [next, ...rest] = await listRunsWaitingOnRun(tx, run.environmentId, run.id);
  if (next === undefined) {
    return;
  }
  await beginHeldRunInTx(tx, deps, next, after, rest);
}

export async function finishRun(session: AdvanceSession): Promise<void> {
  const { tx, deps, loaded, after, now } = session;
  const { run, state, frame } = loaded;
  const { environmentId, id: runId } = run;
  if (state.status === 'in_progress') {
    await appendWorkflowJournal(tx, environmentId, session.journal);
    session.journal = [];
    await saveState(session, frame);
    await refreshWaitingOn(session);
    return;
  }
  await saveState(session, frame);
  const failure = state.status === 'errored' ? failureOf(loaded) : null;
  const ended = await endWorkflowRun(tx, environmentId, runId, {
    status: state.status,
    ...(failure === null
      ? { outputs: state.runOutputs }
      : {
          errorType: workflowErrorTypeOf(failure.code),
          errorCode: failure.code,
          errorNodeId: failure.nodeId,
        }),
    at: now,
  });
  if (ended === null) {
    return;
  }
  await cancelWorkflowRunSteps(tx, environmentId, runId, { at: now });
  session.journal.push(
    failure === null
      ? { runId, kind: 'run_completed' }
      : {
          runId,
          kind: 'run_errored',
          nodeId: failure.nodeId,
          errorType: workflowErrorTypeOf(failure.code),
          errorCode: failure.code,
        },
  );
  await appendWorkflowJournal(tx, environmentId, session.journal);
  session.journal = [];
  const staged = await stageRunEnd(
    tx,
    deps.events,
    ended,
    loaded.definition,
    Object.keys(state.runOutputs),
  );
  if (staged !== null) {
    after.staged.push(staged);
  }
  await releaseEarlierRunWaiters(session, ended);
}

async function saveState(session: AdvanceSession, frame: RunFrame): Promise<void> {
  const { tx, loaded } = session;
  const { environmentId, id } = loaded.run;
  loaded.frame = packFrame(frame, loaded.state);
  await saveWorkflowRunState(tx, environmentId, id, {
    variables: loaded.frame as unknown as Record<string, unknown>,
    stepExecutions: loaded.state.stepExecutions,
    stepOutcomes: session.outcomes,
  });
}

/** C120.1: `waiting-on`, from what the run's steps are doing now. */
async function refreshWaitingOn(session: AdvanceSession): Promise<void> {
  const { tx, loaded } = session;
  const { environmentId, id } = loaded.run;
  const counts = await countWorkflowRunStepStates(tx, environmentId, id);
  const waitingOn =
    counts.active > 0
      ? null
      : counts.childRuns > 0
        ? 'child-run'
        : counts.events > 0
          ? 'event'
          : counts.timers > 0
            ? 'time'
            : null;
  if (waitingOn !== loaded.run.waitingOn) {
    await setWorkflowRunWaitingOn(tx, environmentId, id, waitingOn);
  }
}

/** One completion, played to the end: the caller holds the run's lock. */
export async function applyCompletion(
  session: AdvanceSession,
  completion: StepCompletion,
): Promise<void> {
  const { loaded } = session;
  const done =
    completion.kind === 'step' ? stepKey(completion.iterationPath, completion.nodeId) : null;
  await settle(
    session,
    advance(
      loaded.definition,
      { ...loaded.state, now: session.now.toISOString() },
      completion,
      contextOf(loaded),
    ),
    done,
  );
  await finishRun(session);
}

/** C120: the first advance of a new run. */
export async function applyStart(session: AdvanceSession, first: AdvanceResult): Promise<void> {
  await settle(session, first, null);
  await finishRun(session);
}

export const STEP_LIMIT = WORKFLOW_RUN_LIMITS['step-executions'].value;

/** Runs the first advance of a run row that holds nothing yet. */
export async function beginRun(
  tx: Db,
  deps: EngineDeps,
  run: WorkflowRunRow,
  frame: RunFrame,
  after: AfterCommit,
  startStep: string | null,
): Promise<void> {
  const now = await databaseNow(tx);
  const loaded = await loadRun(tx, run, now);
  const session = await openSession(tx, deps, loaded, after);
  const values = openWorkflowRunValues(run);
  // Workflow 8B (C140.2): `current_case`'s value, from its owner.
  const currentCase = await currentCaseValueOf(tx, run);
  await applyStart(
    session,
    startRun(
      loaded.definition,
      {
        trigger: (values.triggerSnapshot ?? null) as JsonValue,
        inputs: (values.inputs ?? {}) as JsonRecord,
        currentRun: { ...frame.currentRun, 'created-at': run.createdAt.toISOString() },
        now: now.toISOString(),
        ...(startStep === null ? {} : { startStep }),
        ...(currentCase === undefined ? {} : { currentCase }),
      },
      frame.test?.endStep == null ? {} : { endStep: frame.test.endStep },
    ),
  );
}

/** C118.9: a run held behind an earlier one starts, and the rest now wait for it. */
export async function beginHeldRunInTx(
  tx: Db,
  deps: EngineDeps,
  held: WorkflowRunRow,
  after: AfterCommit,
  rest: readonly WorkflowRunRow[],
): Promise<void> {
  const { environmentId, id } = held;
  await saveWorkflowRunWaiter(tx, environmentId, id, null);
  for (const later of rest) {
    await saveWorkflowRunWaiter(tx, environmentId, later.id, id);
  }
  const frame = frameOf(openWorkflowRunValues(held).variables);
  await beginRun(tx, deps, { ...held, waitingOn: null, waitingOnRunId: null }, frame, after, null);
  after.environments.add(environmentId);
}

/** After the commit: best effort, because the sweeps stay the outbox (C117.9). */
export async function flushAfterCommit(deps: EngineDeps, after: AfterCommit): Promise<void> {
  await deps.events.dispatch(after.staged);
  for (const { job, delayMs } of after.wakes) {
    try {
      await deps.steps?.enqueueWorkflowStep(job, delayMs === undefined ? {} : { delayMs });
    } catch {
      // The sweep finds the row.
    }
  }
  for (const task of after.tasks) {
    try {
      await task();
    } catch {
      // C105.5: a storage delete left over goes to the C16 purge and fails nothing.
    }
  }
  for (const environmentId of after.environments) {
    await dispatchEnvironment(deps, environmentId);
  }
}
