/**
 * C152.2, C150.9 (Workflow 9A, `api-flow-actions`; V09): `flow-action-sweep`, every 15 s, under each
 * inquiry's row lock:
 * - a `run_workflow` entry whose run ended is finished and advanced through `next` or `error`;
 * - one past its timeout has its run canceled (outside the lock), then takes `error` (`timeout`);
 * - one still in time stays waiting;
 * - a branch wait past its `maxSeconds` is ended (`wait-elapsed`), one still in time is left;
 * - a redacted inquiry is never touched, and one entry that fails is logged (ids and a code only)
 *   and tried again on the next pass, without stopping the others.
 * The engine's `advanceFlowInTx` (`api-flow-engine`) is replaced by a recorder: what it does with
 * the exit is its own suite's.
 *
 * Every value is synthetic.
 */
import {
  appendInquiryFlowStepInTx,
  getInquiryFlowAction,
  setInquiryFlowPositionInTx,
  type Db,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, type FlowAction } from '@openverify/flow-spec';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceFlowInTx, type FlowExit } from '../../flow-engine/advance.js';
import { runFlowActionInTx, type FlowActionDeps } from '../../flow-actions/run-action.js';
import { ulidIdGenerator } from '../../ports.js';
import { fixedClock, type TestClock } from '../../test-support/fakes.js';
import {
  chain,
  createEngineHarness,
  drain,
  output,
  publish,
  runOf,
  scripted,
  action as workflowAction,
  type EngineHarness,
} from '../../workflows/engine/testing.js';
import { FLOW_ACTION_SWEEP_INTERVAL_MS, FLOW_ACTION_SWEEP_QUEUE } from '../flow-queues.js';
import { createCapturingLogger } from '../testing.js';
import {
  flowActionSweepJob,
  runFlowActionSweep,
  type FlowActionSweepDeps,
} from './flow-actions.js';

vi.mock('../../flow-engine/advance.js', () => ({
  advanceFlowInTx: vi.fn(() => Promise.resolve({ staged: [], after: [] })),
  runFlowAfterCommit: async (advance: { after?: readonly (() => Promise<void>)[] } | null) => {
    for (const run of advance?.after ?? []) {
      await run();
    }
  },
  NO_FLOW_ADVANCE: { staged: [], after: [] },
}));

const advance = vi.mocked(advanceFlowInTx);
const tagging = scripted('tag_object', 'transaction', () => ({
  kind: 'succeeded',
  output: { 'object-id': 'inq_01M5CK16P0D13FXHZSS4TCFBVH', outcome: 'applied', 'tag-count': 1 },
}));

let harness: EngineHarness;
let clock: TestClock;
let logger: ReturnType<typeof createCapturingLogger>;
let actionDeps: FlowActionDeps;
let sweepDeps: FlowActionSweepDeps;

beforeAll(async () => {
  harness = await createEngineHarness([tagging]);
  clock = fixedClock();
  logger = createCapturingLogger();
  actionDeps = {
    events: harness.events,
    clock,
    db: harness.db,
    ids: ulidIdGenerator,
    workflowSteps: harness.steps,
  };
  sweepDeps = {
    db: harness.db,
    clock,
    logger,
    events: harness.events,
    workflowSteps: harness.steps,
  };
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  advance.mockClear();
});

interface Ref {
  environmentId: string;
  inquiryId: string;
}

/** A workflow whose run waits for the step queue, then completes. */
async function waitingWorkflow() {
  const published = await publish(
    harness,
    chain([], {
      trigger: { type: 'trigger-flow', config: {} },
      steps: [
        workflowAction('tag', 'tag_object', { 'object-type': 'inquiry', tag: 'flow' }),
        output({ decision: 'approve' }),
      ],
      edges: [
        { id: 'trigger-next-tag', from: 'trigger', 'from-port': 'next', to: 'tag' },
        { id: 'tag-next-output', from: 'tag', 'from-port': 'next', to: 'output' },
      ],
      outputs: [{ name: 'decision', pii: false }],
    }),
  );
  await harness.database.client.query(
    `update workflow_versions set trigger_type = 'trigger-flow', "grant" = $2::jsonb where id = $1`,
    [published.workflowVersionId, JSON.stringify({ scopes: ['inquiries:write'], pii: false })],
  );
  return published;
}

/** An inquiry at a `run_workflow` step, entered and waiting on its run. */
async function waitingOnRun(timeoutSeconds = 30): Promise<Ref & { action: FlowAction }> {
  const { workflowId, workflowVersionId } = await waitingWorkflow();
  const action: FlowAction = {
    kind: 'run_workflow',
    workflowId,
    version: workflowVersionId,
    timeoutSeconds,
  };
  const flow = flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'sweep-run', version: 1, name: 'Sweep a run' },
    entry: 'run_check',
    steps: [
      { id: 'run_check', type: 'action', action },
      { id: 'done', type: 'completion' },
      { id: 'stopped', type: 'failure' },
    ],
    edges: [
      { id: 'e1', from: 'run_check', port: 'next', to: 'done' },
      { id: 'e2', from: 'run_check', port: 'error', to: 'stopped' },
    ],
  });
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId, {
    flow: flow as unknown as Record<string, unknown>,
  });
  const ref = { environmentId: harness.environmentId, inquiryId: inquiry.id };
  const entered = await harness.db.transaction((tx) =>
    runFlowActionInTx(tx as Db, actionDeps, ref, { stepId: 'run_check', entry: 1, action }),
  );
  expect(entered.state).toBe('waiting');
  // The started run's wake, which the engine runs after the entering transaction commits.
  await entered.after?.();
  return { ...ref, action };
}

/** An inquiry waiting at a branch entry that waits up to `maxSeconds` for a signal. */
async function waitingAtBranch(maxSeconds: number): Promise<Ref & { seq: number }> {
  const flow = flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'sweep-branch', version: 1, name: 'Sweep a branch' },
    entry: 'signals_check',
    steps: [
      {
        id: 'signals_check',
        type: 'branch',
        routes: [
          {
            key: 'bot',
            label: 'Likely a bot',
            condition: { '>': [{ var: 'signals.inquiry/bot_score' }, 0.5] },
            onNull: 'else',
          },
        ],
        waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds },
      },
      { id: 'review_path', type: 'completion' },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'signals_check', port: 'route:bot', to: 'review_path' },
      { id: 'e2', from: 'signals_check', port: 'else', to: 'done' },
    ],
  });
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId, {
    flow: flow as unknown as Record<string, unknown>,
  });
  const ref = { environmentId: harness.environmentId, inquiryId: inquiry.id };
  const seq = await harness.db.transaction(async (tx) => {
    const entry = await appendInquiryFlowStepInTx(tx, ref.environmentId, {
      inquiryId: inquiry.id,
      stepId: 'signals_check',
      stepType: 'branch',
      enteredAt: clock.now(),
    });
    await setInquiryFlowPositionInTx(tx, ref.environmentId, inquiry.id, {
      stepId: 'signals_check',
      state: 'waiting',
      previousStepId: null,
      specVersion: 2,
    });
    return entry.seq;
  });
  return { ...ref, seq };
}

const rowOf = (ref: Ref) =>
  getInquiryFlowAction(harness.db, ref.environmentId, {
    inquiryId: ref.inquiryId,
    stepId: 'run_check',
    entry: 1,
  });

/** The exits the sweep advanced for this inquiry. */
const exitsOf = (ref: Ref): FlowExit[] =>
  advance.mock.calls
    .filter(([, , inquiry]) => inquiry.inquiryId === ref.inquiryId)
    .map(([, , , exit]) => exit);

/** A pass, as the worker runs it every 15 s. */
async function pass() {
  clock.advance(1_000);
  return runFlowActionSweep(sweepDeps);
}

describe('run_workflow waits (C152.2)', () => {
  it('finishes an entry whose run completed and advances it through next', async () => {
    const ref = await waitingOnRun();
    await drain(harness);
    const result = await pass();
    expect(result.settled).toBeGreaterThanOrEqual(1);
    expect(await rowOf(ref)).toMatchObject({ status: 'completed', errorType: null });
    expect(exitsOf(ref)).toEqual([
      { kind: 'action-finished', stepId: 'run_check', entry: 1, port: 'next' },
    ]);
  });

  it('leaves a run still in time waiting', async () => {
    const ref = await waitingOnRun();
    harness.steps.jobs.length = 0;
    await pass();
    expect(await rowOf(ref)).toMatchObject({ status: 'running' });
    expect(exitsOf(ref)).toEqual([]);
  });

  it('cancels a run past its timeout, then takes error with timeout', async () => {
    const ref = await waitingOnRun(5);
    harness.steps.jobs.length = 0;
    clock.advance(5_000);
    const result = await pass();
    expect(result.canceled).toBeGreaterThanOrEqual(1);
    const row = await rowOf(ref);
    expect(row).toMatchObject({ status: 'errored', errorType: 'timeout' });
    expect((await runOf(harness, row?.workflowRunId ?? '')).status).toBe('canceled');
    expect(exitsOf(ref)).toEqual([
      { kind: 'action-finished', stepId: 'run_check', entry: 1, port: 'error' },
    ]);
  });

  it('never touches a redacted inquiry', async () => {
    const ref = await waitingOnRun();
    await drain(harness);
    await harness.database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      ref.inquiryId,
    ]);
    await pass();
    expect(await rowOf(ref)).toMatchObject({ status: 'running' });
    expect(exitsOf(ref)).toEqual([]);
  });

  it('logs an entry that fails with ids and a code, and settles it on the next pass', async () => {
    const ref = await waitingOnRun();
    await drain(harness);
    advance.mockImplementation((_tx, _deps, inquiry) =>
      inquiry.inquiryId === ref.inquiryId
        ? Promise.reject(new Error('connection reset'))
        : Promise.resolve({ staged: [], after: [] }),
    );
    const failed = await pass();
    advance.mockImplementation(() => Promise.resolve({ staged: [], after: [] }));
    expect(failed.failed).toBe(1);
    expect(await rowOf(ref)).toMatchObject({ status: 'running' });
    const logged = logger.entries.filter(({ object }) => object['inquiry-id'] === ref.inquiryId);
    expect(logged).toEqual([
      {
        level: 'error',
        object: {
          'inquiry-id': ref.inquiryId,
          'environment-id': ref.environmentId,
          'step-id': 'run_check',
          reason: 'flow_action_sweep_failed',
        },
        message: expect.any(String) as unknown,
      },
    ]);
    await pass();
    expect(await rowOf(ref)).toMatchObject({ status: 'completed' });
  });
});

describe('branch waits (C150.9, V09)', () => {
  it('ends a branch wait past its maxSeconds, and leaves one still in time', async () => {
    const short = await waitingAtBranch(5);
    const long = await waitingAtBranch(30);
    await pass();
    expect(exitsOf(short)).toEqual([]);
    clock.advance(5_000);
    const result = await pass();
    expect(result.waitsEnded).toBeGreaterThanOrEqual(1);
    expect(exitsOf(short)).toEqual([{ kind: 'wait-elapsed', stepRecordSeq: short.seq }]);
    expect(exitsOf(long)).toEqual([]);
  });
});

describe('flowActionSweepJob (C174.3)', () => {
  it('runs a pass every 15 s, writing events to the outbox', async () => {
    const job = flowActionSweepJob({ db: harness.db, clock, logger });
    expect(job.name).toBe(FLOW_ACTION_SWEEP_QUEUE);
    expect(job.repeat).toEqual({ every: FLOW_ACTION_SWEEP_INTERVAL_MS });
    await expect(job.run()).resolves.toMatchObject({ failed: 0 });
  });
});
