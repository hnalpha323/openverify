/**
 * C152.2, C152.7 (Workflow 9A, `api-flow-actions`): `run_workflow` starts its run through Phase 8's
 * run service in the transaction that enters the step (trigger `trigger-flow`, creator
 * `inquiry-flow` named by the inquiry, one run per inquiry, step and entry), waits, and settles:
 * - a completed run takes `next`, and its outputs are read from Phase 8's sealed run outputs;
 * - an errored run takes `error` (`run_errored`), an operator's cancel `error` (`run_canceled`);
 * - past the timeout the run is canceled through Phase 8's run cancellation, outside the inquiry's
 *   lock, and the entry takes `error` (`timeout`); a timed-out or errored run is never an output;
 * - checked on entry: the workflow of this environment, running, with a `trigger-flow` version; a
 *   resolved version whose grant or egress is wider than the template's publish allowed takes
 *   `error` (`workflow_grant_widened`) and starts nothing.
 *
 * Every value is synthetic.
 */
import { createTestInquiry, testId } from '@openverify/db/testing';
import { getInquiryFlowAction, type Db } from '@openverify/db';
import { flowV2Schema, type FlowAction, type FlowV2 } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionStepError } from '../workflows/engine/action-port.js';
import {
  chain,
  createEngineHarness,
  createEngineHarnessOn,
  drain,
  output,
  publish,
  runOf,
  scripted,
  action as workflowAction,
  type EngineHarness,
} from '../workflows/engine/testing.js';
import { ulidIdGenerator } from '../ports.js';
import { fixedClock, type TestClock } from '../test-support/fakes.js';
import {
  runFlowActionInTx,
  settleFlowActionInTx,
  type FlowActionDeps,
  type FlowActionEntry,
  type FlowActionOutcome,
} from './run-action.js';
import { flowWorkflowScopeInTx } from './workflow-scope.js';

const failing = scripted('create_inquiry', 'transaction', () => {
  throw new ActionStepError('invalid_transition');
});
const tagging = scripted('tag_object', 'transaction', () => ({
  kind: 'succeeded',
  output: { 'object-id': 'inq_01M5CK16P0D13FXHZSS4TCFBVH', outcome: 'applied', 'tag-count': 1 },
}));

/** A workflow whose run waits for the step queue, then completes with `decision`. */
const queued = () =>
  chain([], {
    steps: [
      workflowAction('tag', 'tag_object', { 'object-type': 'inquiry', tag: 'flow' }),
      output({ decision: 'approve' }),
    ],
    edges: [
      { id: 'trigger-next-tag', from: 'trigger', 'from-port': 'next', to: 'tag' },
      { id: 'tag-next-output', from: 'tag', 'from-port': 'next', to: 'output' },
    ],
    outputs: [{ name: 'decision', pii: false }],
  });

/** The grant both scripted steps need; a pinned version runs on it (no later publish widens it). */
const tagGrant = { scopes: ['inquiries:write'], pii: false };

let harness: EngineHarness;
let clock: TestClock;
let deps: FlowActionDeps;

beforeAll(async () => {
  harness = await createEngineHarness([failing, tagging]);
  clock = fixedClock();
  deps = {
    events: harness.events,
    clock,
    db: harness.db,
    ids: ulidIdGenerator,
    workflowSteps: harness.steps,
  };
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const flowRunning = (stepId: string, action: FlowAction): FlowV2 =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'flow-run', version: 1, name: 'Run a workflow' },
    entry: stepId,
    steps: [
      { id: stepId, type: 'action', action },
      { id: 'done', type: 'completion' },
      { id: 'stopped', type: 'failure' },
    ],
    edges: [
      { id: 'e1', from: stepId, port: 'next', to: 'done' },
      { id: 'e2', from: stepId, port: 'error', to: 'stopped' },
    ],
  });

/** A running workflow whose published version takes `trigger-flow`, with its grant and egress. */
async function flowWorkflow(
  definition = chain([], {
    steps: [output({ decision: 'approve' })],
    outputs: [{ name: 'decision', pii: false }],
  }),
  options: {
    grant?: { scopes: string[]; pii: boolean };
    egress?: unknown[];
    status?: string;
    on?: EngineHarness;
  } = {},
) {
  const on = options.on ?? harness;
  const flowDefinition = { ...definition, trigger: { type: 'trigger-flow', config: {} } };
  const published = await publish(on, flowDefinition as never, {
    ...(options.status === undefined ? {} : { status: options.status }),
  });
  await on.database.client.query(
    `update workflow_versions set trigger_type = 'trigger-flow', "grant" = $2::jsonb, egress = $3::jsonb
      where id = $1`,
    [
      published.workflowVersionId,
      JSON.stringify(options.grant ?? { scopes: [], pii: false }),
      JSON.stringify(options.egress ?? []),
    ],
  );
  return published;
}

async function inquiryRunning(action: FlowAction, stepId = 'run_check') {
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId, {
    flow: flowRunning(stepId, action) as unknown as Record<string, unknown>,
  });
  return { environmentId: harness.environmentId, inquiryId: inquiry.id };
}

const runAction = (
  workflowId: string,
  more: Partial<Extract<FlowAction, { kind: 'run_workflow' }>> = {},
): FlowAction => ({
  kind: 'run_workflow',
  workflowId,
  version: 'latest-published',
  timeoutSeconds: 30,
  ...more,
});

async function enter(
  ref: { environmentId: string; inquiryId: string },
  entry: FlowActionEntry,
): Promise<FlowActionOutcome> {
  const outcome = await harness.db.transaction((tx) =>
    runFlowActionInTx(tx as Db, deps, ref, entry),
  );
  await harness.events.dispatch(outcome.staged);
  await outcome.after?.();
  return outcome;
}

async function settle(
  ref: { environmentId: string; inquiryId: string },
  entry: FlowActionEntry,
): Promise<FlowActionOutcome> {
  const outcome = await harness.db.transaction((tx) =>
    settleFlowActionInTx(tx as Db, deps, ref, entry),
  );
  await harness.events.dispatch(outcome.staged);
  return outcome;
}

const rowOf = (
  ref: { environmentId: string; inquiryId: string },
  stepId = 'run_check',
  entry = 1,
) =>
  getInquiryFlowAction(harness.db, ref.environmentId, { inquiryId: ref.inquiryId, stepId, entry });

const scopeOf = (ref: { environmentId: string; inquiryId: string }) =>
  harness.db.transaction((tx) => flowWorkflowScopeInTx(tx as Db, ref));

describe('run_workflow on entry (C152.2)', () => {
  it('starts one run per entry, from the flow, with the declared inputs, and waits', async () => {
    const { workflowId } = await flowWorkflow(queued());
    const action = runAction(workflowId, {
      inputs: {
        country: { path: 'verifications.id_card.country-code' },
        tier: { literal: 'gold' },
      },
    });
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = {
      stepId: 'run_check',
      entry: 1,
      action,
      scope: { verifications: { id_card: { 'country-code': 'US' } } },
    };
    const waiting = await enter(ref, entry);
    expect(waiting).toMatchObject({ state: 'waiting', retryAfterMs: 2_000 });
    const row = await rowOf(ref);
    expect(row).toMatchObject({ status: 'running', errorType: null });
    const run = await runOf(harness, row?.workflowRunId ?? '');
    expect(run).toMatchObject({
      triggerType: 'trigger-flow',
      creatorType: 'inquiry-flow',
      creatorId: ref.inquiryId,
      causedByPrincipal: null,
    });
    // A repeat of the entry starts nothing again.
    const again = await enter(ref, entry);
    expect(again.state).toBe('waiting');
    const { rows } = await harness.database.client.query<{ count: string }>(
      `select count(*) from workflow_runs where creator_type = 'inquiry-flow' and creator_id = $1`,
      [ref.inquiryId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('takes next at once when the run completes in the transaction that starts it', async () => {
    const { workflowId } = await flowWorkflow();
    const action = runAction(workflowId);
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    expect(await enter(ref, entry)).toMatchObject({ state: 'done', port: 'next', errorType: null });
    expect(await rowOf(ref)).toMatchObject({ status: 'completed' });
    expect((await scopeOf(ref)).run_check).toEqual({
      status: 'completed',
      'error-type': null,
      outputs: { decision: 'approve' },
    });
  });

  it('takes next once the run completed, and reads its outputs from the run', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow(queued(), { grant: tagGrant });
    const action = runAction(workflowId, { version: workflowVersionId });
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    await enter(ref, entry);
    expect((await settle(ref, entry)).state).toBe('waiting');
    await drain(harness);
    expect(await settle(ref, entry)).toMatchObject({
      state: 'done',
      port: 'next',
      errorType: null,
    });
    expect(await rowOf(ref)).toMatchObject({ status: 'completed' });
    expect(await scopeOf(ref)).toEqual({
      run_check: { status: 'completed', 'error-type': null, outputs: { decision: 'approve' } },
    });
  });

  it('takes error when the run errors, and reads no output', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow(
      chain([workflowAction('make', 'create_inquiry', {})]),
      { grant: tagGrant },
    );
    const action = runAction(workflowId, { version: workflowVersionId });
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    await enter(ref, entry);
    await drain(harness);
    expect(failing.calls).toContain('make');
    expect(await settle(ref, entry)).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'run_errored',
    });
    expect(await scopeOf(ref)).toEqual({
      run_check: { status: 'errored', 'error-type': 'run_errored', outputs: null },
    });
  });

  it('cancels the run at the timeout, outside the lock, and takes error', async () => {
    const { workflowId } = await flowWorkflow(
      chain([workflowAction('make', 'create_inquiry', {})]),
    );
    const action = runAction(workflowId, { timeoutSeconds: 5 });
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    await enter(ref, entry);
    harness.steps.jobs.length = 0;
    const before = await settle(ref, entry);
    expect(before).toMatchObject({ state: 'waiting' });
    expect(before.state === 'waiting' && before.cancelDue).toBeFalsy();
    clock.advance(5_000);
    const due = await settle(ref, entry);
    expect(due).toMatchObject({ state: 'waiting', cancelDue: true });
    await due.after?.();
    const row = await rowOf(ref);
    expect((await runOf(harness, row?.workflowRunId ?? '')).status).toBe('canceled');
    expect(await settle(ref, entry)).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'timeout',
    });
    expect(await scopeOf(ref)).toEqual({
      run_check: { status: 'timed-out', 'error-type': 'timeout', outputs: null },
    });
  });

  it('takes error when an operator canceled the run before its timeout', async () => {
    const { workflowId } = await flowWorkflow(
      chain([workflowAction('make', 'create_inquiry', {})]),
    );
    const action = runAction(workflowId);
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    await enter(ref, entry);
    harness.steps.jobs.length = 0;
    const row = await rowOf(ref);
    await harness.database.client.query(
      `update workflow_runs set status = 'canceled', completed_at = now() where id = $1`,
      [row?.workflowRunId],
    );
    expect(await settle(ref, entry)).toMatchObject({ port: 'error', errorType: 'run_canceled' });
    expect((await scopeOf(ref)).run_check).toMatchObject({ status: 'canceled', outputs: null });
  });
});

describe('the target checked on entry (C152.2; review P07)', () => {
  const refused = async (action: FlowAction, errorType: string) => {
    const ref = await inquiryRunning(action);
    const outcome = await enter(ref, { stepId: 'run_check', entry: 1, action });
    expect(outcome).toMatchObject({ state: 'done', port: 'error', errorType });
    expect(await rowOf(ref)).toMatchObject({ status: 'errored', errorType, workflowRunId: null });
    expect((await scopeOf(ref)).run_check).toEqual({
      status: 'errored',
      'error-type': errorType,
      outputs: null,
    });
  };

  it('starts nothing for a latest version wider than the template’s publish allowed', async () => {
    const { workflowId } = await flowWorkflow(undefined, {
      grant: { scopes: ['inquiries:write'], pii: true },
    });
    await refused(runAction(workflowId), 'workflow_grant_widened');
  });

  it('starts nothing for a target with egress the template did not acknowledge', async () => {
    const egress = [{ 'step-id': 'send', paths: ['trigger.name'], destination: 'example.com' }];
    const { workflowId, workflowVersionId } = await flowWorkflow(queued(), { egress });
    await refused(runAction(workflowId, { version: workflowVersionId }), 'workflow_grant_widened');
    const action = runAction(workflowId, { version: workflowVersionId });
    const ref = await inquiryRunning(action);
    await harness.database.client.query(
      `update inquiry_template_versions set acknowledgements = $2::jsonb
        where id = (select inquiry_template_version_id from inquiries where id = $1)`,
      [
        ref.inquiryId,
        JSON.stringify([
          {
            key: 'egress:run_check',
            'acknowledged-by': testId('usr'),
            'acknowledged-at': '2026-11-04T12:00:00Z',
          },
        ]),
      ],
    );
    expect(await enter(ref, { stepId: 'run_check', entry: 1, action })).toMatchObject({
      state: 'waiting',
    });
  });

  it('runs a pinned version, which no later publish can widen', async () => {
    const { workflowId, workflowVersionId } = await flowWorkflow(queued(), {
      grant: { scopes: ['inquiries:write'], pii: false },
    });
    const action = runAction(workflowId, { version: workflowVersionId });
    const ref = await inquiryRunning(action);
    expect(await enter(ref, { stepId: 'run_check', entry: 1, action })).toMatchObject({
      state: 'waiting',
    });
  });

  it('starts nothing for a workflow that is paused, of another environment, or not a flow trigger', async () => {
    const paused = await flowWorkflow(undefined, { status: 'paused' });
    await refused(runAction(paused.workflowId), 'workflow_not_running');
    const other = await createEngineHarnessOn(harness);
    const elsewhere = await flowWorkflow(undefined, { on: other });
    await refused(runAction(elsewhere.workflowId), 'workflow_not_found');
    const api = await publish(harness, chain([]));
    await refused(runAction(api.workflowId), 'workflow_trigger_invalid');
  });

  it('settles nothing for an entry never entered, and replays a finished one', async () => {
    const { workflowId } = await flowWorkflow();
    const action = runAction(workflowId);
    const ref = await inquiryRunning(action);
    const entry: FlowActionEntry = { stepId: 'run_check', entry: 1, action };
    expect(await settle(ref, entry)).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'action_not_entered',
    });
    await enter(ref, entry);
    expect(await settle(ref, entry)).toMatchObject({ state: 'done', port: 'next' });
    expect(await enter(ref, entry)).toMatchObject({ state: 'done', port: 'next' });
  });

  it('takes error when an input reads the scope and none was given', async () => {
    const { workflowId } = await flowWorkflow();
    await refused(
      runAction(workflowId, { inputs: { country: { path: 'device.kind' } } }),
      'scope_unavailable',
    );
  });
});
