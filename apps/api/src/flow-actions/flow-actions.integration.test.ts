/**
 * C178.2, C152.2, C150.9, C152.8, C151.11 (Workflow 9A, `api-flow-actions`) against Postgres 17, with
 * the real flow engine (`advanceFlowInTx`, `api-flow-engine`) and Phase 8's run service:
 * - `run_workflow`: the flow waits on a run that completes (next, to completion), errors (error, to
 *   failure) and times out (the run canceled by the sweep, error, to failure); a run completing while
 *   the sweep cancels it at its timeout ends one way only, the run and the flow agreeing;
 * - a wider workflow version published after the template starts nothing (`workflow_grant_widened`);
 * - a provisional signal snapshot arriving within a branch's wait, right after consent, moves it
 *   through the route's own `onNull` (`not_yet_collected`, never Phase 7's review-class
 *   `collector_missing`); one arriving after the sweep ended the wait changes nothing;
 * - the redaction of an inquiry whose flow ran `update_account_fields` lists the account it wrote.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  getInquiry,
  getInquiryFlowAction,
  listInquiryFlowSignalSnapshots,
  listInquiryFlowSteps,
  lockInquiry,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  type Database,
  type Db,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  seedSessionSignalBody,
  seedWorkflow,
  seedWorkflowVersion,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import { flowV2Schema, type FlowAction } from '@openverify/flow-spec';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advanceFlowInTx,
  runFlowAfterCommit,
  type AdvanceFlowDeps,
  type FlowAdvance,
} from '../flow-engine/advance.js';
import { positionFlowInTx } from '../flow-engine/position.js';
import { processFlowSignalSnapshot } from '../jobs/flow/signal-snapshot.js';
import { runFlowActionSweep } from '../jobs/repeatable/flow-actions.js';
import { createCapturingLogger, createMemoryStorage } from '../jobs/testing.js';
import type { FlowSignalSnapshotJob } from '../ports.js';
import { ensureDefaultAccountType } from '../services/accounts.js';
import { createRedactionService } from '../services/redaction.js';
import { createRecordingAuditLogger, fixedClock, type TestClock } from '../test-support/fakes.js';
import { ActionStepError } from '../workflows/engine/action-port.js';
import {
  chain,
  createEngineHarnessOnDatabase,
  drain,
  output,
  runOf,
  scripted,
  action as workflowAction,
  type EngineHarness,
} from '../workflows/engine/testing.js';

const keyring = createKeyring(randomBytes(32));
const BOT = 'inquiry/bot_score';
const SESSIONS = 'inquiry/session_count';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let harness: EngineHarness;
let clock: TestClock;
const snapshotJobs: FlowSignalSnapshotJob[] = [];
let deps: AdvanceFlowDeps & {
  db: Db;
  workflowSteps: EngineHarness['steps'];
};

let failRuns = false;
const tagging = scripted('tag_object', 'transaction', () => {
  if (failRuns) {
    throw new ActionStepError('invalid_transition');
  }
  return {
    kind: 'succeeded',
    output: { 'object-id': 'inq_01M5CK16P0D13FXHZSS4TCFBVH', outcome: 'applied', 'tag-count': 1 },
  };
});

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  harness = createEngineHarnessOnDatabase(db, tenant, [tagging]);
  await ensureDefaultAccountType(db, tenant.environment.id);
  clock = fixedClock(new Date());
  deps = {
    db,
    events: harness.events,
    clock,
    workflowSteps: harness.steps,
    flowSignalSnapshots: {
      enqueueFlowSignalSnapshot: (job) => {
        snapshotJobs.push(job);
        return Promise.resolve();
      },
    },
  };
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const sweep = () =>
  runFlowActionSweep({
    db,
    clock,
    logger: createCapturingLogger(),
    events: harness.events,
    workflowSteps: harness.steps,
  });

/** The definition of a workflow whose run waits for one queued step, then outputs `decision`. */
const waitingDefinition = () =>
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
  });

/** A published `trigger-flow` version of `workflowId` with `grant`. */
async function flowVersion(workflowId: string, versionNumber: number, scopes: string[]) {
  const { id } = await seedWorkflowVersion(db, harness.environmentId, {
    workflowId,
    versionNumber,
    status: 'published',
    definition: waitingDefinition(),
  });
  await pool.query(
    `update workflow_versions set trigger_type = 'trigger-flow', "grant" = $2::jsonb where id = $1`,
    [id, JSON.stringify({ scopes, pii: false })],
  );
  return id;
}

/** A running workflow with one `trigger-flow` version holding `scopes`. */
async function flowWorkflow(scopes: string[] = ['inquiries:write']) {
  const workflow = await seedWorkflow(db, harness.environmentId, {
    kind: 'workflow',
    status: 'running',
  });
  const versionId = await flowVersion(workflow.id, 1, scopes);
  return { workflowId: workflow.id, versionId };
}

/** consent -> `middle` steps -> done (completion) | stopped (failure). */
function flowOf(middle: Record<string, unknown>[], edges: Record<string, unknown>[]) {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'flow-actions-it', version: 1, name: 'Flow actions' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
      ...middle,
      { id: 'done', type: 'completion' },
      { id: 'stopped', type: 'failure' },
    ],
    edges,
  });
}

const actionFlow = (stepId: string, action: FlowAction) =>
  flowOf(
    [{ id: stepId, type: 'action', action }],
    [
      { id: 'e1', from: 'consent', port: 'next', to: stepId },
      { id: 'e2', from: stepId, port: 'next', to: 'done' },
      { id: 'e3', from: stepId, port: 'error', to: 'stopped' },
    ],
  );

const branchFlow = () =>
  flowOf(
    [
      {
        id: 'signals_check',
        type: 'branch',
        routes: [
          {
            key: 'bot',
            label: 'Likely a bot',
            condition: { '>': [{ var: `signals.${BOT}` }, 50] },
            onNull: 'else',
          },
        ],
        waitFor: { facts: [`signals.${BOT}`, `signals.${SESSIONS}`], maxSeconds: 10 },
      },
    ],
    [
      { id: 'e1', from: 'consent', port: 'next', to: 'signals_check' },
      { id: 'e2', from: 'signals_check', port: 'route:bot', to: 'stopped' },
      { id: 'e3', from: 'signals_check', port: 'else', to: 'done' },
    ],
  );

/** Runs `work` under the inquiry's lock, then what it left for after the commit. */
async function advancing(inquiryId: string, work: (tx: Db) => Promise<FlowAdvance>): Promise<void> {
  const advance = await db.transaction(async (tx) => {
    await lockInquiry(tx, harness.environmentId, inquiryId);
    return work(tx);
  });
  await harness.events.dispatch(advance.staged);
  await runFlowAfterCommit(advance);
}

/**
 * An inquiry started by the engine, with one session that consented and collects session
 * integrity, and its consent recorded: the engine walks on from the consent step.
 */
async function consented(flow: ReturnType<typeof flowOf>) {
  const { inquiry } = await createTestInquiry(db, harness.environmentId, {
    flow: flow as unknown as Record<string, unknown>,
  });
  const ref = { environmentId: harness.environmentId, inquiryId: inquiry.id };
  await advancing(inquiry.id, (tx) => positionFlowInTx(tx, deps, ref));
  const session = await createInquirySession(db, harness.environmentId, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await pool.query(
    `update inquiry_sessions set signals_collected = '{session-integrity}' where id = $1`,
    [session.id],
  );
  await recordInquirySessionConsent(db, harness.environmentId, session.id, {
    acceptedAt: clock.now(),
    textKeys: ['consent.processing'],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  await advancing(inquiry.id, (tx) =>
    advanceFlowInTx(tx, deps, ref, { kind: 'consent-recorded', sessionId: session.id }),
  );
  return { ...ref, sessionId: session.id };
}

const inquiryOf = async (inquiryId: string) => getInquiry(db, harness.environmentId, inquiryId);
const rowOf = (inquiryId: string, stepId = 'run_check') =>
  getInquiryFlowAction(db, harness.environmentId, { inquiryId, stepId, entry: 1 });
const runAction = (workflowId: string, more: Partial<FlowAction> = {}): FlowAction =>
  ({
    kind: 'run_workflow',
    workflowId,
    version: 'latest-published',
    timeoutSeconds: 30,
    ...more,
  }) as FlowAction;

describe('run_workflow against a Phase 8 run (C152.2, C178.2)', () => {
  it('waits on a run that completes, then takes next to completion', async () => {
    const { workflowId, versionId } = await flowWorkflow();
    const ref = await consented(
      actionFlow('run_check', runAction(workflowId, { version: versionId })),
    );
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'run_check',
      flowState: 'waiting',
      status: 'pending',
    });
    await drain(harness);
    clock.advance(1_000);
    await sweep();
    expect(await rowOf(ref.inquiryId)).toMatchObject({ status: 'completed' });
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'done',
      status: 'completed',
    });
  });

  it('waits on a run that errors, then takes error to the failure step', async () => {
    const { workflowId, versionId } = await flowWorkflow();
    const ref = await consented(
      actionFlow('run_check', runAction(workflowId, { version: versionId })),
    );
    failRuns = true;
    try {
      await drain(harness);
    } finally {
      failRuns = false;
    }
    clock.advance(1_000);
    await sweep();
    expect(await rowOf(ref.inquiryId)).toMatchObject({
      status: 'errored',
      errorType: 'run_errored',
    });
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'stopped',
      status: 'failed',
    });
  });

  it('cancels a run at its timeout, then takes error to the failure step', async () => {
    const { workflowId, versionId } = await flowWorkflow();
    const ref = await consented(
      actionFlow('run_check', runAction(workflowId, { version: versionId, timeoutSeconds: 5 })),
    );
    harness.steps.jobs.length = 0;
    clock.advance(6_000);
    await sweep();
    const row = await rowOf(ref.inquiryId);
    expect(row).toMatchObject({ status: 'errored', errorType: 'timeout' });
    expect((await runOf(harness, row?.workflowRunId ?? '')).status).toBe('canceled');
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'stopped',
      status: 'failed',
    });
  });

  it('ends one way only when the run completes as the sweep cancels it at its timeout (C151.11)', async () => {
    const { workflowId, versionId } = await flowWorkflow();
    const ref = await consented(
      actionFlow('run_check', runAction(workflowId, { version: versionId, timeoutSeconds: 5 })),
    );
    clock.advance(6_000);
    await Promise.all([drain(harness), sweep()]);
    await sweep();
    const row = await rowOf(ref.inquiryId);
    const run = await runOf(harness, row?.workflowRunId ?? '');
    const inquiry = await inquiryOf(ref.inquiryId);
    if (run.status === 'completed') {
      expect(row).toMatchObject({ status: 'completed' });
      expect(inquiry).toMatchObject({ flowStepId: 'done', status: 'completed' });
    } else {
      expect(run.status).toBe('canceled');
      expect(row).toMatchObject({ status: 'errored', errorType: 'timeout' });
      expect(inquiry).toMatchObject({ flowStepId: 'stopped', status: 'failed' });
    }
    const exits = (await listInquiryFlowSteps(db, harness.environmentId, ref.inquiryId)).filter(
      ({ stepId }) => stepId === 'run_check',
    );
    expect(exits).toHaveLength(1);
  });

  it('starts nothing on a wider workflow version published after the template', async () => {
    const { workflowId } = await flowWorkflow([]);
    const before = await consented(actionFlow('run_check', runAction(workflowId)));
    expect(await rowOf(before.inquiryId)).toMatchObject({ status: 'running' });
    await flowVersion(workflowId, 2, ['inquiries:write']);
    const after = await consented(actionFlow('run_check', runAction(workflowId)));
    expect(await rowOf(after.inquiryId)).toMatchObject({
      status: 'errored',
      errorType: 'workflow_grant_widened',
      workflowRunId: null,
    });
    expect(await inquiryOf(after.inquiryId)).toMatchObject({
      flowStepId: 'stopped',
      status: 'failed',
    });
  });
});

describe('provisional signal snapshots and a branch’s wait (C150.9, C178.2)', () => {
  const jobFor = (inquiryId: string): FlowSignalSnapshotJob => {
    const job = snapshotJobs.find((requested) => requested.inquiryId === inquiryId);
    if (job === undefined) {
      throw new Error('the engine requested no snapshot for this branch entry');
    }
    return job;
  };
  const snapshotDeps = () => ({
    db,
    clock,
    logger: createCapturingLogger(),
    events: harness.events,
    keyring,
  });

  it('lets a branch right after consent follow its own onNull at its deadline, without review (V06)', async () => {
    const ref = await consented(branchFlow());
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'signals_check',
      flowState: 'waiting',
    });
    const job = jobFor(ref.inquiryId);
    expect([...job.names].sort()).toEqual([BOT, SESSIONS]);
    expect(await processFlowSignalSnapshot(job, snapshotDeps())).toEqual({
      outcome: 'written',
      written: 2,
    });
    const snapshots = await listInquiryFlowSignalSnapshots(db, harness.environmentId, {
      inquiryId: ref.inquiryId,
      stepRecordSeq: job.stepRecordSeq,
    });
    expect(snapshots.find(({ name }) => name === BOT)).toMatchObject({
      value: null,
      nullReason: 'not_yet_collected',
    });
    // A null still waits (C150.5); at the deadline the route's own onNull (else) decides, and a
    // not_yet_collected null is not of the review class, so the inquiry completes without review.
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({ flowStepId: 'signals_check' });
    clock.advance(11_000);
    await sweep();
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'done',
      status: 'completed',
    });
  });

  it('moves the branch as soon as a snapshot with its values arrives within the wait', async () => {
    const ref = await consented(branchFlow());
    await seedSessionSignalBody(db, harness.environmentId, {
      inquirySessionId: ref.sessionId,
      components: { 'sandbox-outcome': 'human' },
      behaviour: null,
    });
    const job = jobFor(ref.inquiryId);
    await processFlowSignalSnapshot(job, snapshotDeps());
    // bot_score 5 (a sandbox human, C90.9) is not above 50: else, at once, with no clock moved.
    expect(await inquiryOf(ref.inquiryId)).toMatchObject({
      flowStepId: 'done',
      status: 'completed',
    });
  });

  it('changes nothing when the snapshot arrives after the sweep ended the wait', async () => {
    const ref = await consented(branchFlow());
    clock.advance(11_000);
    await sweep();
    const ended = await inquiryOf(ref.inquiryId);
    expect(ended).toMatchObject({ flowStepId: 'done', status: 'completed' });
    const job = jobFor(ref.inquiryId);
    expect(await processFlowSignalSnapshot(job, snapshotDeps())).toEqual({
      outcome: 'skipped',
      written: 0,
    });
    expect(await inquiryOf(ref.inquiryId)).toEqual(ended);
  });
});

describe('the redaction of an inquiry whose flow copied to its account (C152.8, V08)', () => {
  it('lists the account update_account_fields wrote, in its result and audit entry', async () => {
    const ref = await consented(
      actionFlow('copy_country', {
        kind: 'update_account_fields',
        mapping: { address_country_code: { literal: 'US' } },
      }),
    );
    const inquiry = await inquiryOf(ref.inquiryId);
    expect(inquiry).toMatchObject({ status: 'completed' });
    const audit = createRecordingAuditLogger();
    const service = createRedactionService({
      db,
      storage: createMemoryStorage(),
      events: harness.events,
      clock,
      audit,
    });
    const result = await service.redactInquiry(
      { environmentId: harness.environmentId, organizationId: harness.organizationId },
      ref.inquiryId,
      { type: 'api-key', id: testId('key') },
    );
    expect(result.flowCopyTargets).toEqual([
      { accountId: inquiry?.accountId, keys: ['address_country_code'] },
    ]);
    expect(audit.withAction('inquiry.redacted')[0]?.metadata).toMatchObject({
      'flow-copy-account-ids': [inquiry?.accountId],
    });
    expect(await rowOf(ref.inquiryId, 'copy_country')).toBeNull();
  });
});
