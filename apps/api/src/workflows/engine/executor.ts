/**
 * C117.3-C117.6: the two transaction shapes. Control-flow nodes run in `advance`, inside the
 * transaction that completed the step before them. Every other step is claimed, run and completed:
 *
 * 1. The claim is a conditional update of a `ready` row: a fresh token, a lease, `attempt + 1`.
 * 2. The checks that fail closed: the handler exists, a revoked publisher, the grant, the cause.
 * 3. The handler runs. A `transaction` handler runs in the completion's own transaction, so its change,
 *    its effect row and the step's completion commit or roll back as one. An `outside` handler runs
 *    with no transaction, under a heartbeat that aborts it when the claim is lost.
 * 4. Completion is fenced by the token. In a `transaction` shape the run's row is locked **last**,
 *    after the handler, because a domain path (a redaction above all) locks its object and then
 *    reaches the run: the other order would deadlock. A lost claim throws, which rolls the effect back.
 *
 * A failure that may retry records `retry_scheduled` with a new `due_at`; BullMQ's attempts are for
 * infrastructure alone (C117.6). A serialisation or deadlock error gives the claim back and rethrows.
 * Logs and the journal carry ids and codes, never a value (C117.11).
 */
import { randomUUID } from 'node:crypto';
import {
  appendWorkflowJournal,
  claimWorkflowEffect,
  currentWorkflowSnapshot,
  claimWorkflowRunStep,
  completeWorkflowEffect,
  completeWorkflowRunStep,
  extendWorkflowStepClaim,
  getEventCause,
  getWorkflowRun,
  getWorkflowRunStep,
  getWorkflowRunWorkflow,
  listAllWorkflowRunSteps,
  lockWorkflowRun,
  markWorkflowEffectUnknown,
  getEnvironment,
  openWorkflowEffectResult,
  readyDueWorkflowTimer,
  recordWorkflowRunSubjects,
  releaseWorkflowEffect,
  releaseWorkflowStepClaim,
  type Db,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
} from '@openverify/db';
import type { WorkflowStep } from '@openverify/contracts';
import {
  WORKFLOW_RUN_LIMITS,
  effectKey,
  parseTemplate,
  renderTemplate,
  runScope,
  stepKey,
  workflowErrorTypeOf,
  type JsonRecord,
  type JsonValue,
} from '@openverify/workflow-engine';
import {
  httpsLiteralHost,
  type ActionGrant,
  type AnyActionRegistryEntry,
} from '@openverify/workflow-engine/actions';
import { UNMASKED, piiMaskFor, type PiiMask } from '../../auth/pii.js';
import { runWithEventCause } from '../../events/cause-context.js';
import type { WorkflowStepJob } from '../../ports.js';
import {
  ActionStepError,
  type ActionContext,
  type ActionHandler,
  type ActionResolution,
  type ActionResult,
  type ActionTestRun,
} from './action-port.js';
import {
  STEP_LIMIT,
  applyCompletion,
  emptyAfterCommit,
  finishRun,
  flushAfterCommit,
  openSession,
  type AdvanceSession,
  type AfterCommit,
} from './advance-run.js';
import { causeLacksScope, grantOf, missingFromGrant } from './authority.js';
import { databaseNow, type EngineDeps } from './deps.js';
import { dispatchEnvironment } from './dispatcher.js';
import { definitionAt, loadRun, type LoadedRun } from './run-frame.js';
import { hostIsListed } from '../actions/https/hosts.js';
import { enterEventWaitInTx, filterDecision } from './wait-resolution.js';

const STEP_CLAIMS = WORKFLOW_RUN_LIMITS['step-claims'].value;
const OUTPUT_BYTES = WORKFLOW_RUN_LIMITS['step-output-bytes'].value;
/** C117.4 (ours): an action that states no limit. */
export const DEFAULT_LEASE_SECONDS = 60;

/** A claim lost between the handler and its completion: the transaction rolls back. */
class ClaimLost extends Error {
  override readonly name = 'ClaimLost';
}

const RETRYABLE_SQLSTATE: ReadonlySet<string> = new Set(['40001', '40P01']);

/** C117.6: a serialisation or deadlock error, anywhere in its causes. */
function isSerializationError(error: unknown): boolean {
  for (let current = error; typeof current === 'object' && current !== null;) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && RETRYABLE_SQLSTATE.has(code)) {
      return true;
    }
    current = cause;
  }
  return false;
}

interface Claim {
  step: WorkflowRunStepRow;
  token: string;
}

const job = (step: WorkflowRunStepRow): WorkflowStepJob => ({
  environmentId: step.environmentId,
  runId: step.runId,
  stepId: step.id,
  attempt: step.attempt + 1,
});

async function claimStep(
  deps: EngineDeps,
  step: WorkflowRunStepRow,
  lease: number,
): Promise<Claim | null> {
  const token = randomUUID();
  return deps.db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    const claimed = await claimWorkflowRunStep(tx, step.environmentId, {
      stepId: step.id,
      claimedBy: token,
      claimedUntil: new Date(now.getTime() + lease * 1_000),
    });
    if (claimed === null) {
      return null;
    }
    await appendWorkflowJournal(tx, step.environmentId, [
      {
        runId: step.runId,
        kind: 'step_started',
        stepId: step.id,
        nodeId: step.nodeId,
        iterationPath: step.iterationPath,
        attempt: claimed.attempt,
      },
    ]);
    return { step: claimed, token };
  });
}

/** Under the run's lock, or `null` when the run ended: a late completion changes nothing. */
async function lockedSession(
  tx: Db,
  deps: EngineDeps,
  run: Pick<WorkflowRunRow, 'environmentId' | 'id'>,
  after: AfterCommit,
): Promise<AdvanceSession | null> {
  const locked = await lockWorkflowRun(tx, run.environmentId, run.id);
  if (locked?.status !== 'in_progress') {
    return null;
  }
  const now = await databaseNow(tx);
  return openSession(tx, deps, await loadRun(tx, locked, now), after);
}

function subjectsIn(output: JsonValue, found: Set<string>): void {
  if (typeof output === 'string') {
    if (/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(output)) {
      found.add(output);
    }
  } else if (Array.isArray(output)) {
    output.forEach((item) => {
      subjectsIn(item, found);
    });
  } else if (typeof output === 'object' && output !== null) {
    Object.values(output).forEach((item) => {
      subjectsIn(item, found);
    });
  }
}

/** C120.9: what the step named, and the ids in its output. */
async function recordSubjects(
  tx: Db,
  step: WorkflowRunStepRow,
  output: JsonValue,
  named: Extract<ActionResult, { kind: 'succeeded' }>['subjects'],
): Promise<void> {
  const found = new Set<string>();
  subjectsIn(output, found);
  await recordWorkflowRunSubjects(tx, step.environmentId, step.runId, [
    ...(named ?? []),
    ...[...found].map((subjectId) => ({ subjectId, source: 'output' as const })),
  ]);
}

/** A failed step's end, fenced by its claim, and the advance that follows. */
async function failClaimed(
  tx: Db,
  deps: EngineDeps,
  claim: Claim,
  failure: { code: string; output?: JsonRecord | null | undefined; unknown?: boolean },
  after: AfterCommit,
): Promise<void> {
  const { step, token } = claim;
  const session = await lockedSession(
    tx,
    deps,
    { environmentId: step.environmentId, id: step.runId },
    after,
  );
  if (session === null) {
    return;
  }
  const errorType = workflowErrorTypeOf(failure.code);
  const completed = await completeWorkflowRunStep(tx, step.environmentId, {
    stepId: step.id,
    claimedBy: token,
    status: 'failed',
    output: failure.output ?? null,
    errorType,
    errorCode: failure.code,
    at: session.now,
  });
  if (completed === null) {
    return;
  }
  if (failure.unknown === true) {
    session.outcomes = {
      ...session.outcomes,
      'unknown-effect': (session.outcomes['unknown-effect'] ?? 0) + 1,
    };
  }
  session.journal.push({
    runId: step.runId,
    kind: 'step_failed',
    stepId: step.id,
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    attempt: step.attempt,
    errorType,
    errorCode: failure.code,
  });
  await applyCompletion(session, {
    kind: 'step',
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    outcome: 'failed',
    code: failure.code,
  });
}

function readOutput(entry: AnyActionRegistryEntry, output: JsonRecord): JsonRecord | null {
  const parsed = entry.output.safeParse(output);
  return parsed.success ? (parsed.data as JsonRecord) : null;
}

/** C115.5: parsed by the registry's schema, under the journal's cap, or the step's error. */
function parsedOutput(
  entry: AnyActionRegistryEntry,
  output: JsonRecord,
): { ok: true; output: JsonRecord } | { ok: false; code: string } {
  const value = readOutput(entry, output);
  if (value === null) {
    return { ok: false, code: 'execution_error' };
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > OUTPUT_BYTES) {
    return { ok: false, code: 'payload_too_large' };
  }
  return { ok: true, output: value };
}

async function succeedClaimed(
  tx: Db,
  deps: EngineDeps,
  claim: Claim,
  output: JsonRecord,
  named: Extract<ActionResult, { kind: 'succeeded' }>['subjects'],
  after: AfterCommit,
  console?: readonly string[],
): Promise<void> {
  const { step, token } = claim;
  const session = await lockedSession(
    tx,
    deps,
    { environmentId: step.environmentId, id: step.runId },
    after,
  );
  if (session === null) {
    throw new ClaimLost();
  }
  const completed = await completeWorkflowRunStep(tx, step.environmentId, {
    stepId: step.id,
    claimedBy: token,
    status: 'succeeded',
    output,
    console: session.loaded.frame.test === null ? undefined : console,
    at: session.now,
  });
  if (completed === null) {
    throw new ClaimLost();
  }
  session.outcomes = {
    ...session.outcomes,
    succeeded: (session.outcomes.succeeded ?? 0) + 1,
  };
  session.journal.push({
    runId: step.runId,
    kind: 'step_succeeded',
    stepId: step.id,
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    attempt: step.attempt,
  });
  await recordSubjects(tx, step, output, named);
  await applyCompletion(session, {
    kind: 'step',
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    outcome: 'succeeded',
    output,
  });
}

/** C127.2: an action made its object; the step keeps its row and waits for that object's events. */
async function waitClaimed(
  tx: Db,
  deps: EngineDeps,
  claim: Claim,
  result: Extract<ActionResult, { kind: 'waiting' }>,
  after: AfterCommit,
  snapshot: string,
): Promise<void> {
  const { step, token } = claim;
  const session = await lockedSession(
    tx,
    deps,
    { environmentId: step.environmentId, id: step.runId },
    after,
  );
  if (session === null) {
    throw new ClaimLost();
  }
  const { loaded } = session;
  const key = stepKey(step.iterationPath, step.nodeId);
  loaded.frame = {
    ...loaded.frame,
    actionWaits: {
      ...loaded.frame.actionWaits,
      [key]: { timeoutCode: result.timeoutCode, carry: result.carry },
    },
  };
  await enterEventWaitInTx(session, step, {
    correlationKey: result.correlationKey,
    events: result.events,
    timeoutSeconds: result.timeoutSeconds,
    filter: null,
    onNull: null,
    claimedBy: token,
    snapshot,
  });
  const current = await getWorkflowRunStep(tx, step.environmentId, step.id);
  if (current?.status !== 'waiting' && current?.status !== 'ready') {
    throw new ClaimLost();
  }
  await recordSubjects(tx, step, null, result.subjects);
  await finishRun(session);
}

/** A retry's new `due_at`, or the failure when no attempt is left (C117.6). */
function retryDelaySeconds(
  stepDefinition: WorkflowStep,
  entry: AnyActionRegistryEntry,
  attempt: number,
  retryAfterSeconds: number | undefined,
): number | null {
  if (!entry.retry.allowed) {
    return null;
  }
  const own =
    stepDefinition.type === 'action' ? stepDefinition.retry?.['intervals-seconds'] : undefined;
  const interval = (own ?? entry.retry.defaultIntervalsSeconds)[attempt - 1];
  if (interval === undefined) {
    return null;
  }
  return retryAfterSeconds === undefined ? interval : Math.min(retryAfterSeconds, interval);
}

async function retryClaimed(
  deps: EngineDeps,
  claim: Claim,
  delaySeconds: number,
  after: AfterCommit,
): Promise<void> {
  const { step, token } = claim;
  await deps.db.transaction(async (tx) => {
    const session = await lockedSession(
      tx,
      deps,
      { environmentId: step.environmentId, id: step.runId },
      after,
    );
    if (session === null) {
      return;
    }
    const { loaded } = session;
    // C117.7: retries count, and the interpreter does not see them.
    if (loaded.state.stepExecutions + 1 > STEP_LIMIT) {
      loaded.state = {
        ...loaded.state,
        status: 'errored',
        failures: [
          ...loaded.state.failures,
          { nodeId: null, iterationPath: '', code: 'step_limit_exceeded' },
        ],
      };
      await finishRun(session);
      return;
    }
    const dueAt = new Date(session.now.getTime() + delaySeconds * 1_000);
    const released = await releaseWorkflowStepClaim(tx, step.environmentId, {
      stepId: step.id,
      claimedBy: token,
      dueAt,
    });
    if (released === null) {
      return;
    }
    loaded.state = { ...loaded.state, stepExecutions: loaded.state.stepExecutions + 1 };
    session.journal.push({
      runId: step.runId,
      kind: 'retry_scheduled',
      stepId: step.id,
      nodeId: step.nodeId,
      iterationPath: step.iterationPath,
      attempt: step.attempt,
    });
    await finishRun(session);
    after.wakes.push({ job: job(released), delayMs: delaySeconds * 1_000 });
  });
}

/** What a finished handler did, in the transaction that completes the step. */
async function applyResult(
  tx: Db,
  deps: EngineDeps,
  claim: Claim,
  key: string,
  entry: AnyActionRegistryEntry,
  result: ActionResult,
  after: AfterCommit,
  snapshot: string,
): Promise<void> {
  const { step } = claim;
  const { environmentId } = step;
  after.staged.push(...(result.staged ?? []));
  if (result.afterCommit !== undefined) {
    after.tasks.push(result.afterCommit);
  }
  if (result.kind === 'unknown') {
    await markWorkflowEffectUnknown(tx, environmentId, key);
    await failUnknown(tx, deps, claim, result.output, after);
    return;
  }
  if (result.kind === 'failed') {
    // C117.5: nothing took effect, so a resume runs it again.
    await releaseWorkflowEffect(tx, environmentId, key);
    await failClaimed(tx, deps, claim, { code: result.code, output: result.output }, after);
    return;
  }
  if (result.kind === 'waiting') {
    await waitClaimed(tx, deps, claim, result, after, snapshot);
    return;
  }
  const parsed = parsedOutput(entry, result.output);
  if (!parsed.ok) {
    throw new ActionStepError(parsed.code);
  }
  await completeWorkflowEffect(tx, environmentId, key, parsed.output, result.copy);
  await succeedClaimed(tx, deps, claim, parsed.output, result.subjects, after, result.console);
}

/** C120.3: `unknown_effect` fails the step, and blocks a resume until it is acknowledged. */
const failUnknown = (
  tx: Db,
  deps: EngineDeps,
  claim: Claim,
  output: JsonRecord | null,
  after: AfterCommit,
): Promise<void> =>
  failClaimed(tx, deps, claim, { code: 'unknown_effect', output, unknown: true }, after);

interface Execution {
  claim: Claim;
  run: WorkflowRunRow;
  loaded: LoadedRun;
  stepDefinition: WorkflowStep;
  entry: AnyActionRegistryEntry;
  context: ActionContext;
}

function renderConfig(
  loaded: LoadedRun,
  step: WorkflowRunStepRow,
  raw: JsonRecord,
  entry: AnyActionRegistryEntry,
): { ok: true; config: JsonRecord } | { ok: false; code: string } {
  if (entry.kind === 'egress') {
    return { ok: true, config: raw };
  }
  const { roots } = runScope(loaded.state, step.iterationPath);
  const config: Record<string, JsonValue> = {};
  for (const [name, member] of Object.entries(raw)) {
    // C113.8, C123.2: code is no template, whatever it holds and however long it is.
    if (entry.key === 'evaluate_code' && name === 'source') {
      config[name] = member;
      continue;
    }
    const template = parseTemplate(member);
    if (!template.ok) {
      return { ok: false, code: 'execution_error' };
    }
    const rendered = renderTemplate(template.template, { roots }, 'json');
    if (!rendered.ok) {
      return { ok: false, code: rendered.code };
    }
    config[name] = rendered.value;
  }
  return { ok: true, config };
}

const testRunOf = (loaded: LoadedRun): ActionTestRun | null =>
  loaded.frame.test === null
    ? null
    : {
        id: loaded.run.id,
        allowHosts: loaded.frame.test.allowHosts,
        acknowledgements: loaded.frame.test.acknowledgements,
      };

/** C120.7: what a test run's request allows this step; `null` runs it. */
const SIMULATE = 'simulate';

function testRunRefusal(
  loaded: LoadedRun,
  step: WorkflowRunStepRow,
  entry: AnyActionRegistryEntry,
  raw: JsonRecord,
): string | null {
  const { test } = loaded.frame;
  if (test === null) {
    return null;
  }
  if (
    (entry.irreversible || entry.adverse !== 'never') &&
    !test.acknowledgements.includes(`irreversible:${step.nodeId}`)
  ) {
    return SIMULATE;
  }
  if (entry.key === 'make_https_request') {
    const host = typeof raw.url === 'string' ? httpsLiteralHost(raw.url) : null;
    const allowed =
      test.egressAllowed &&
      host !== null &&
      hostIsListed(host, test.allowHosts) &&
      test.acknowledgements.includes(`egress:${step.nodeId}`);
    return allowed ? null : 'test_run_egress_disabled';
  }
  return null;
}

/** C117.4: extends the lease a third of the way through; a lost claim aborts the handler. */
function heartbeat(
  deps: EngineDeps,
  claim: Claim,
  leaseSeconds: number,
  abort: AbortController,
): () => void {
  const { step, token } = claim;
  const every = deps.heartbeatMs ?? (leaseSeconds * 1_000) / 3;
  const timer = setInterval(() => {
    void (async () => {
      const now = await databaseNow(deps.db);
      const held = await extendWorkflowStepClaim(deps.db, step.environmentId, {
        stepId: step.id,
        claimedBy: token,
        claimedUntil: new Date(now.getTime() + leaseSeconds * 1_000),
      });
      if (!held) {
        abort.abort();
      }
    })().catch(() => undefined);
  }, every);
  return () => {
    clearInterval(timer);
  };
}

/** C121.3: the root's causing principal goes into every event this step stages. */
const causeOf = (loaded: LoadedRun) => ({
  runId: loaded.run.id,
  principal: loaded.run.causedByPrincipal,
  testRunId: loaded.run.isTestRun ? loaded.run.id : null,
  bulkId: null,
  principalHeldInquiriesWrite: null,
  testRunAllowsTriggers: loaded.frame.test?.allowTriggers === true,
});

/** Rolls a retryable attempt back, effect row and all; the retry is written after. */
class RetryAfterRollback extends Error {
  override readonly name = 'RetryAfterRollback';

  constructor(readonly failure: Extract<ActionResult, { kind: 'failed' }>) {
    super(failure.code);
  }
}

const missingResume = (): Promise<ActionResult> =>
  Promise.resolve({ kind: 'failed', code: 'execution_error' });

async function runInTransaction(
  deps: EngineDeps,
  execution: Execution,
  handler: Extract<ActionHandler, { shape: 'transaction' }>,
  resolution: ActionResolution | null,
  after: AfterCommit,
): Promise<void> {
  const { claim, context, entry, loaded } = execution;
  const { step } = claim;
  const key = effectKey(step.runId, step.nodeId, step.iterationPath);
  await deps.db.transaction(async (tx) => {
    // K8-6: before the handler reads anything, so a wait it answers sees what finished after.
    const snapshot = await currentWorkflowSnapshot(tx);
    const { effect, claimed } = await claimWorkflowEffect(tx, step.environmentId, {
      id: deps.ids.newId('wfef'),
      runId: step.runId,
      stepId: step.id,
      effectKey: key,
      kind: step.actionKey ?? 'action',
    });
    if (!claimed && effect.status === 'done' && resolution === null) {
      // C117.5: a repeated attempt returns the first result.
      const output = (openWorkflowEffectResult(effect) ?? {}) as JsonRecord;
      await succeedClaimed(tx, deps, claim, output, undefined, after);
      return;
    }
    const result = await runWithEventCause(causeOf(loaded), () =>
      resolution === null
        ? handler.execute(tx, context)
        : (handler.resume ?? missingResume)(tx, context, resolution),
    );
    if (result.kind === 'failed' && result.retryable === true) {
      throw new RetryAfterRollback(result);
    }
    await applyResult(tx, deps, claim, key, entry, result, after, snapshot);
  });
}

async function runOutside(
  deps: EngineDeps,
  execution: Execution,
  handler: Extract<ActionHandler, { shape: 'outside' }>,
  resolution: ActionResolution | null,
  after: AfterCommit,
): Promise<void> {
  const { claim, context, entry, loaded } = execution;
  const { step } = claim;
  const { environmentId } = step;
  const key = effectKey(step.runId, step.nodeId, step.iterationPath);
  const { delivery } = entry;
  if (delivery !== 'pure' && resolution === null) {
    const { effect, claimed } = await deps.db.transaction((tx) =>
      claimWorkflowEffect(tx, environmentId, {
        id: deps.ids.newId('wfef'),
        runId: step.runId,
        stepId: step.id,
        effectKey: key,
        kind: step.actionKey ?? 'action',
      }),
    );
    if (!claimed && effect.status === 'done') {
      const output = (openWorkflowEffectResult(effect) ?? {}) as JsonRecord;
      await deps.db.transaction((tx) => succeedClaimed(tx, deps, claim, output, undefined, after));
      return;
    }
    if (!claimed && delivery === 'at-most-once') {
      // C126.1: a claimed effect from a crash; whether it went out is not known. Never resend.
      if (effect.status === 'unknown' && loaded.frame.acknowledged.includes(key)) {
        const output: JsonRecord = {
          delivery: 'unknown',
          provider: 'unknown',
          sandbox: context.environmentKind === 'sandbox',
          'message-ref': null,
        };
        await deps.db.transaction((tx) =>
          succeedClaimed(tx, deps, claim, output, undefined, after),
        );
        return;
      }
      await deps.db.transaction(async (tx) => {
        await markWorkflowEffectUnknown(tx, environmentId, key);
        await failUnknown(tx, deps, claim, null, after);
      });
      return;
    }
  }
  // K8-6: before the handler reads anything, so a wait it answers sees what finished after.
  const snapshot = await currentWorkflowSnapshot(deps.db);
  const result = await runWithEventCause(causeOf(loaded), () =>
    resolution === null
      ? handler.execute(context)
      : (handler.resume ?? missingResume)(context, resolution),
  );
  if (result.kind === 'failed' && delivery === 'at-most-once') {
    // C126.5: `failed` is proof of non-delivery; anything else is `unknown`.
    await releaseWorkflowEffect(deps.db, environmentId, key);
  }
  if (result.kind === 'failed' && result.retryable === true) {
    throw new RetryAfterRollback(result);
  }
  await deps.db.transaction((tx) =>
    applyResult(tx, deps, claim, key, entry, result, after, snapshot),
  );
}

async function failWith(
  deps: EngineDeps,
  claim: Claim,
  code: string,
  after: AfterCommit,
  output?: JsonRecord,
): Promise<void> {
  await deps.db.transaction((tx) => failClaimed(tx, deps, claim, { code, output }, after));
}

/** A failed attempt: another, if one is left (C117.6), or the step's failure. */
async function afterFailure(
  deps: EngineDeps,
  execution: Execution,
  failure: Extract<ActionResult, { kind: 'failed' }>,
  after: AfterCommit,
): Promise<void> {
  const { claim, entry, stepDefinition } = execution;
  const delay =
    failure.retryable === true
      ? retryDelaySeconds(stepDefinition, entry, claim.step.attempt, failure.retryAfterSeconds)
      : null;
  if (delay === null) {
    await failWith(deps, claim, failure.code, after, failure.output);
  } else {
    await retryClaimed(deps, claim, delay, after);
  }
}

async function runHandler(
  deps: EngineDeps,
  execution: Execution,
  handler: ActionHandler,
  resolution: ActionResolution | null,
  after: AfterCommit,
): Promise<void> {
  const { claim, entry } = execution;
  try {
    if (handler.shape === 'transaction') {
      await runInTransaction(deps, execution, handler, resolution, after);
    } else {
      await runOutside(deps, execution, handler, resolution, after);
    }
  } catch (error) {
    if (error instanceof RetryAfterRollback) {
      await afterFailure(deps, execution, error.failure, after);
    } else if (error instanceof ActionStepError) {
      await afterFailure(
        deps,
        execution,
        { kind: 'failed', code: error.code, ...error.options },
        after,
      );
    } else if (isSerializationError(error)) {
      await giveBack(deps, claim);
      throw error;
    } else if (handler.shape === 'outside' && entry.delivery === 'at-most-once') {
      // Whether it went out is not known: the claim lapses, and the next one reads `unknown`.
      throw error;
    } else if (!(error instanceof ClaimLost)) {
      await failWith(deps, claim, 'execution_error', after);
    }
  }
}

/** C117.4: a retryable error releases the claim before rethrowing. */
async function giveBack(deps: EngineDeps, claim: Claim): Promise<void> {
  await releaseWorkflowStepClaim(deps.db, claim.step.environmentId, {
    stepId: claim.step.id,
    claimedBy: claim.token,
    dueAt: null,
  });
}

async function actionContext(
  deps: EngineDeps,
  claim: Claim,
  run: WorkflowRunRow,
  loaded: LoadedRun,
  entry: AnyActionRegistryEntry,
  stepDefinition: WorkflowStep,
  config: JsonRecord,
  signal: AbortSignal,
  now: Date,
): Promise<ActionContext> {
  const { step } = claim;
  const workflowActing = await actingOfRun(deps, run);
  if (deps.services === undefined) {
    throw new Error('only the worker runs handlers');
  }
  return {
    services: deps.services,
    engine: deps,
    entry,
    environmentId: run.environmentId,
    environmentKind: workflowActing.environmentKind,
    organizationId: workflowActing.ctx.organizationId,
    runId: run.id,
    rootRunId: run.rootRunId ?? run.id,
    parentRunId: run.parentRunId,
    depth: run.depth,
    triggerDepth: run.triggerDepth,
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    stepId: step.id,
    nodeId: step.nodeId,
    iterationPath: step.iterationPath,
    attempt: step.attempt,
    effectKey: effectKey(run.id, step.nodeId, step.iterationPath),
    acting: workflowActing,
    grant: grantOf(run.effectiveGrant),
    config,
    scope: runScope(loaded.state, step.iterationPath),
    definition: definitionAt(loaded, step.iterationPath),
    step: stepDefinition,
    state: loaded.state,
    testRun: testRunOf(loaded),
    signal,
    now,
  };
}

/** A principal holding nothing: the mask of a run whose grant has no `pii`. */
const MASKED: PiiMask = piiMaskFor({
  kind: 'user',
  userId: '',
  userSessionId: '',
  organizationId: '',
  environmentId: '',
  environmentKind: 'sandbox',
  permissions: new Set(),
  mfaSatisfied: true,
});

/** The run as an actor (C121.1): it reads what its grant allows. */
async function actingOfRun(deps: EngineDeps, run: WorkflowRunRow) {
  const environment = await getEnvironment(deps.db, run.environmentId);
  if (environment === null) {
    throw new Error('a run’s environment is gone');
  }
  return {
    ctx: { organizationId: environment.organizationId, environmentId: run.environmentId },
    actor: { type: 'workflow-run' as const, id: run.id },
    mask: grantOf(run.effectiveGrant).pii ? UNMASKED : MASKED,
    environmentKind: environment.kind,
  };
}

async function resolutionOf(
  db: Db,
  step: WorkflowRunStepRow,
  loaded: LoadedRun,
): Promise<ActionResolution | null> {
  const eventId = step.resolvedByEventId;
  const wait = loaded.frame.actionWaits[stepKey(step.iterationPath, step.nodeId)];
  if (eventId === null || wait === undefined) {
    return null;
  }
  const event = await getEventCause(db, step.environmentId, eventId);
  return {
    eventId,
    eventName: event?.name ?? '',
    payload: (event?.payload ?? null) as JsonValue,
    carry: wait.carry,
  };
}

/** What this config needs; a config the entry cannot read fails closed. */
function grantOfStep(entry: AnyActionRegistryEntry, config: JsonRecord): ActionGrant | null {
  try {
    return entry.grant(config as never);
  } catch {
    return null;
  }
}

async function executeAction(
  deps: EngineDeps,
  claim: Claim,
  run: WorkflowRunRow,
  after: AfterCommit,
): Promise<void> {
  const { step } = claim;
  const now = await databaseNow(deps.db);
  const loaded = await loadRun(deps.db, run, now);
  const definition = definitionAt(loaded, step.iterationPath);
  const stepDefinition = definition.steps.find(({ id }) => id === step.nodeId);
  if (stepDefinition?.type !== 'action') {
    await failWith(deps, claim, 'execution_error', after);
    return;
  }
  const { actions } = deps;
  const entry = actions.registry.get(step.actionKey ?? '', step.actionVersion ?? 0);
  const handler = actions.handlers.get(step.actionKey ?? '', step.actionVersion ?? 0);
  if (entry === undefined) {
    await failWith(deps, claim, 'execution_error', after);
    return;
  }
  if (handler === undefined) {
    await failWith(deps, claim, 'provider_not_configured', after);
    return;
  }
  const raw = stepDefinition.config;
  const refusal = testRunRefusal(loaded, step, entry, raw);
  if (refusal === SIMULATE) {
    // C120.7, decision 77: no effect and no decision record, and the row says so.
    await simulateClaimed(deps, claim, after);
    return;
  }
  if (refusal !== null) {
    await failWith(deps, claim, refusal, after);
    return;
  }
  const rendered = renderConfig(loaded, step, raw, entry);
  if (!rendered.ok) {
    await failWith(deps, claim, rendered.code, after);
    return;
  }
  const { config } = rendered;
  const needed = grantOfStep(entry, config);
  if (needed === null) {
    await failWith(deps, claim, 'execution_error', after);
    return;
  }
  if (missingFromGrant(grantOf(run.effectiveGrant), needed).length > 0) {
    await failWith(deps, claim, 'run_grant_insufficient', after);
    return;
  }
  const abort = new AbortController();
  const context = await actionContext(
    deps,
    claim,
    run,
    loaded,
    entry,
    stepDefinition,
    config,
    abort.signal,
    now,
  );
  const workflow = await getWorkflowRunWorkflow(deps.db, run.environmentId, run.workflowId);
  const gated = entry.kind === 'egress' || entry.irreversible || entry.adverse !== 'never';
  if (workflow?.pausedReason === 'publisher_revoked' && gated) {
    await failWith(deps, claim, 'publisher_revoked', after);
    return;
  }
  if (entry.causeChecked) {
    const steps = await listAllWorkflowRunSteps(deps.db, run.environmentId, run.id);
    const lacks = await causeLacksScope(deps.db, run, context.organizationId, steps, needed.scopes);
    if (lacks) {
      await deps.db.transaction(async (tx) => {
        const followUp = await handler.onCauseRefused?.(tx, context);
        after.staged.push(...(followUp?.staged ?? []));
        if (followUp?.afterCommit !== undefined) {
          after.tasks.push(followUp.afterCommit);
        }
        await failClaimed(tx, deps, claim, { code: 'cause_lacks_scope' }, after);
      });
      return;
    }
  }
  const resolution = await resolutionOf(deps.db, step, loaded);
  const execution = { claim, run, loaded, stepDefinition, entry, context };
  const lease = handler.leaseSeconds?.(config) ?? DEFAULT_LEASE_SECONDS;
  await extendWorkflowStepClaim(deps.db, run.environmentId, {
    stepId: step.id,
    claimedBy: claim.token,
    claimedUntil: new Date(now.getTime() + lease * 1_000),
  });
  const stop = heartbeat(deps, claim, lease, abort);
  try {
    await runHandler(deps, execution, handler, resolution, after);
  } finally {
    stop();
  }
}

/** C120.7: a test run's step that makes no effect. */
async function simulateClaimed(deps: EngineDeps, claim: Claim, after: AfterCommit): Promise<void> {
  const { step, token } = claim;
  await deps.db.transaction(async (tx) => {
    const session = await lockedSession(
      tx,
      deps,
      { environmentId: step.environmentId, id: step.runId },
      after,
    );
    if (session === null) {
      return;
    }
    await completeWorkflowRunStep(tx, step.environmentId, {
      stepId: step.id,
      claimedBy: token,
      status: 'succeeded',
      output: {},
      simulated: true,
      at: session.now,
    });
    session.outcomes = {
      ...session.outcomes,
      succeeded: (session.outcomes.succeeded ?? 0) + 1,
    };
    session.journal.push({
      runId: step.runId,
      kind: 'step_succeeded',
      stepId: step.id,
      nodeId: step.nodeId,
      iterationPath: step.iterationPath,
    });
    await applyCompletion(session, {
      kind: 'step',
      nodeId: step.nodeId,
      iterationPath: step.iterationPath,
      outcome: 'succeeded',
      output: {},
    });
  });
}

const RESOLVER_TYPES: Readonly<Record<string, string>> = {
  usr: 'user',
  key: 'api-key',
  wfr: 'workflow-run',
};

/** C119.3: what a resolved wait outputs; C128.2 reads it. */
function waitOutput(eventId: string, event: Awaited<ReturnType<typeof getEventCause>>): JsonRecord {
  const principal = event?.causedByPrincipal ?? event?.causedByRunId ?? null;
  return {
    'resolved-by': 'event',
    'event-id': eventId,
    'event-name': event?.name ?? null,
    'resolver-type': principal === null ? null : (RESOLVER_TYPES[principal.slice(0, 3)] ?? null),
    'resolver-id': principal,
    'resolved-via': principal === null ? null : event?.causedByBulkId == null ? 'single' : 'bulk',
    'resolver-held-inquiries-write': event?.principalHeldInquiriesWrite ?? null,
  };
}

/** C119.3: a wait's event, re-read at the completion, so a filter's error reaches the step. */
async function completeWait(
  deps: EngineDeps,
  claim: Claim,
  run: WorkflowRunRow,
  after: AfterCommit,
): Promise<void> {
  const { step } = claim;
  const now = await databaseNow(deps.db);
  const loaded = await loadRun(deps.db, run, now);
  const eventId = step.resolvedByEventId;
  if (eventId === null) {
    await deps.db.transaction((tx) => succeedClaimed(tx, deps, claim, {}, undefined, after));
    return;
  }
  const event = await getEventCause(deps.db, step.environmentId, eventId);
  const decision = filterDecision(step, loaded.state, event?.payload ?? null);
  if (decision.kind === 'error') {
    await failWith(deps, claim, decision.code, after);
    return;
  }
  await deps.db.transaction((tx) =>
    succeedClaimed(tx, deps, claim, waitOutput(eventId, event), undefined, after),
  );
}

/** C117.3, C119: one job: a stale one changes nothing. */
export async function runStepJob(deps: EngineDeps, input: WorkflowStepJob): Promise<void> {
  const { environmentId, stepId } = input;
  const after = emptyAfterCommit();
  try {
    let step = await getWorkflowRunStep(deps.db, environmentId, stepId);
    if (step?.status === 'waiting') {
      const now = await databaseNow(deps.db);
      step = await readyDueWorkflowTimer(deps.db, environmentId, stepId, now);
    }
    if (step?.status !== 'ready') {
      return;
    }
    const now = await databaseNow(deps.db);
    if (step.dueAt !== null && step.dueAt > now) {
      return;
    }
    const run = await getWorkflowRun(deps.db, environmentId, step.runId);
    if (run?.status !== 'in_progress') {
      return;
    }
    const claim = await claimStep(deps, step, DEFAULT_LEASE_SECONDS);
    if (claim === null) {
      return;
    }
    deps.logger?.info(
      {
        environmentId,
        runId: step.runId,
        stepId,
        nodeId: step.nodeId,
        actionKey: step.actionKey,
        attempt: claim.step.attempt,
        lagMs: step.dueAt === null ? null : now.getTime() - step.dueAt.getTime(),
      },
      'workflow step claimed',
    );
    if (claim.step.claims > STEP_CLAIMS) {
      await failWith(deps, claim, 'execution_error', after);
    } else if (claim.step.nodeType === 'action') {
      await executeAction(deps, claim, run, after);
    } else {
      await completeWait(deps, claim, run, after);
    }
    const ended = await getWorkflowRunStep(deps.db, environmentId, stepId);
    deps.logger?.info(
      {
        environmentId,
        runId: step.runId,
        stepId,
        nodeId: step.nodeId,
        actionKey: step.actionKey,
        status: ended?.status ?? null,
        errorCode: ended?.errorCode ?? null,
        errorType: ended?.errorType ?? null,
        durationMs: deps.clock.now().getTime() - now.getTime(),
      },
      'workflow step finished',
    );
  } finally {
    await flushAfterCommit(deps, after);
    await dispatchEnvironment(deps, environmentId);
  }
}
