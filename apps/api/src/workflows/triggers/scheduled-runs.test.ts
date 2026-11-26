/**
 * C118.3: a sweeper creates a scheduled run at its time with creator `scheduled-run`, and Schedule
 * Workflow writes the row. A target that went away is canceled with its reason, never left pending,
 * and a child's grant is checked when the child is created (C121.3). The engine's start is faked.
 * Every value is synthetic.
 */
import { newId, type WorkflowDefinition } from '@openverify/contracts';
import {
  createScheduledRun,
  listDueScheduledRuns,
  type Db,
  type NewScheduledRun,
  type ScheduledRunRow,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowVersion,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import { ulidIdGenerator } from '../../ports.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import type { ActionContext } from '../engine/action-port.js';
import type { WorkflowServices } from '../services.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { SCHEDULE_WORKFLOW_HANDLER } from './schedule-workflow.js';
import { fireScheduledRun } from './scheduled-runs.js';

const engine = vi.hoisted(() => ({ start: vi.fn(), wake: vi.fn() }));
vi.mock('../engine/start-run.js', () => ({
  startWorkflowRunInTx: engine.start,
  wakeStartedRun: engine.wake,
}));

const NOW = new Date('2026-10-20T12:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;
let rateLimiter: RateLimiter;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  environmentId = (await createTestTenant(db)).environment.id;
  rateLimiter = createAllowAllRateLimiter();
  engine.start.mockReset();
  engine.start.mockImplementation(() =>
    Promise.resolve({ run: { id: newId('wfr') }, created: true, after: {} }),
  );
});

const deps = () =>
  ({
    db,
    clock: { now: () => NOW },
    services: { rateLimiter } as unknown as WorkflowServices,
    steps: { enqueueWorkflowStep: () => Promise.resolve() },
  }) as unknown as WorkflowWorkerDeps;

const definition = (
  options: { trigger?: unknown; inputs?: readonly unknown[] } = {},
): WorkflowDefinition =>
  ({
    'schema-version': 1,
    trigger: options.trigger ?? { type: 'trigger-schedule', config: {} },
    inputs: options.inputs ?? [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  }) as unknown as WorkflowDefinition;

async function target(
  options: {
    definition?: WorkflowDefinition;
    status?: string;
    grant?: { scopes: readonly string[]; pii: boolean };
  } = {},
) {
  const workflow = await seedWorkflow(db, environmentId, { status: options.status ?? 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: options.definition ?? definition(),
  });
  await database.client.query(`update workflow_versions set "grant" = $1::jsonb where id = $2`, [
    JSON.stringify(options.grant ?? { scopes: [], pii: false }),
    version.id,
  ]);
  await database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  return { workflowId: workflow.id, versionId: version.id };
}

async function sourceRun(
  options: {
    grant?: { scopes: readonly string[]; pii: boolean };
    depth?: number;
    triggerDepth?: number;
    principal?: string;
  } = {},
) {
  const { workflowId, versionId } = await target();
  const run = await seedWorkflowRun(db, environmentId, {
    workflowId,
    workflowVersionId: versionId,
  });
  await database.client.query(
    `update workflow_runs set effective_grant = $1::jsonb, depth = $2, trigger_depth = $3,
       caused_by_principal = $4 where id = $5`,
    [
      JSON.stringify(options.grant ?? { scopes: ['inquiries:write'], pii: true }),
      options.depth ?? 0,
      options.triggerDepth ?? 0,
      options.principal ?? null,
      run.id,
    ],
  );
  return run.id;
}

const row = (input: Partial<NewScheduledRun> & { targetWorkflowId: string }) =>
  createScheduledRun(db, environmentId, {
    id: newId('srrun'),
    sourceRunId: null,
    subjectId: null,
    baseAt: NOW,
    offsetValue: 1,
    offsetUnit: 'hours',
    offsetDirection: 'after',
    fireAt: NOW,
    inputs: null,
    ...input,
  });

const fire = (scheduled: ScheduledRunRow) =>
  db.transaction((tx) => fireScheduledRun(tx, deps(), scheduled));

async function stored(id: string) {
  const { rows } = await database.client.query<{
    status: string;
    reason_code: string | null;
    workflow_run_id: string | null;
  }>(`select status, reason_code, workflow_run_id from scheduled_runs where id = $1`, [id]);
  return rows[0];
}

const startInput = () => engine.start.mock.calls[0]?.[2] as Record<string, unknown>;

describe('fireScheduledRun (C118.3)', () => {
  it('starts the run with creator scheduled-run, and marks the row', async () => {
    const { workflowId, versionId } = await target();
    const principal = newId('key');
    const source = await sourceRun({ depth: 1, triggerDepth: 2, principal });
    const subjectId = newId('inq');
    const scheduled = await row({
      targetWorkflowId: workflowId,
      sourceRunId: source,
      subjectId,
      inputs: {},
    });

    const started = await fire(scheduled);

    expect(startInput()).toMatchObject({
      environmentId,
      workflowId,
      workflowVersionId: versionId,
      triggerType: 'trigger-schedule',
      scheduledRunId: scheduled.id,
      creator: { type: 'scheduled-run', id: scheduled.id },
      trigger: { id: subjectId, type: 'inquiry' },
      inputs: {},
      subjectIds: [subjectId],
      depth: 2,
      triggerDepth: 2,
      rootRunId: source,
      causedByPrincipal: principal,
    });
    expect(started?.created).toBe(true);
    expect(await stored(scheduled.id)).toMatchObject({
      status: 'run_created',
      workflow_run_id: started?.run.id,
    });
  });

  it('reads a null trigger for a run about no object', async () => {
    const { workflowId } = await target();
    const source = await sourceRun();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(startInput()).toMatchObject({ trigger: null, subjectIds: [] });
  });

  it('holds the inputs it was given to the version that runs', async () => {
    const { workflowId } = await target({
      definition: definition({ inputs: [{ name: 'amount', type: 'number', required: true }] }),
    });
    const source = await sourceRun();
    const scheduled = await row({
      targetWorkflowId: workflowId,
      sourceRunId: source,
      inputs: { amount: 'not a number' },
    });

    await expect(fire(scheduled)).resolves.toBeNull();

    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'trigger_input_invalid',
    });
  });

  it.each(['paused', 'archived'])('cancels for a %s target, with its reason', async (status) => {
    const { workflowId } = await target();
    await database.client.query(
      `update workflows set status = $1, archived_at = case when $1 = 'archived' then now() end
       where id = $2`,
      [status, workflowId],
    );
    const source = await sourceRun();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(engine.start).not.toHaveBeenCalled();
    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'workflow_not_running',
    });
  });

  it('cancels a target whose live version is not a scheduled one', async () => {
    const { workflowId } = await target({
      definition: definition({ trigger: { type: 'trigger-api', config: {} } }),
    });
    const source = await sourceRun();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'workflow_trigger_mismatch',
    });
  });

  it('cancels past the depth limit (C117.7)', async () => {
    const { workflowId } = await target();
    const source = await sourceRun({ depth: 5 });
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'run_depth_exceeded',
    });
  });

  it('checks the child’s grant now, because the target can have widened (C121.3)', async () => {
    const { workflowId } = await target({
      grant: { scopes: ['inquiries:write', 'accounts:write'], pii: false },
    });
    const source = await sourceRun({ grant: { scopes: ['inquiries:write'], pii: false } });
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(engine.start).not.toHaveBeenCalled();
    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'run_grant_insufficient',
    });
  });

  it('refuses PII its source never held', async () => {
    const { workflowId } = await target({ grant: { scopes: [], pii: true } });
    const source = await sourceRun({ grant: { scopes: [], pii: false } });
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(await stored(scheduled.id)).toMatchObject({ reason_code: 'run_grant_insufficient' });
  });

  it('cancels when the run that asked for it is gone: nothing bounds it', async () => {
    const { workflowId } = await target();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: newId('wfr') });

    await fire(scheduled);

    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'source_run_missing',
    });
  });

  it('cancels a version it cannot read', async () => {
    const { workflowId, versionId } = await target();
    await database.client.query(
      `update workflow_versions set definition = '{}'::jsonb where id = $1`,
      [versionId],
    );
    const source = await sourceRun();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });

    await fire(scheduled);

    expect(await stored(scheduled.id)).toMatchObject({
      status: 'canceled',
      reason_code: 'definition_unreadable',
    });
  });

  it('stays pending past the run limiter (C117.8)', async () => {
    const { workflowId } = await target();
    const source = await sourceRun();
    const scheduled = await row({ targetWorkflowId: workflowId, sourceRunId: source });
    rateLimiter = { consume: () => Promise.reject(new Error('down')) };

    await expect(fire(scheduled)).resolves.toBeNull();

    expect(engine.start).not.toHaveBeenCalled();
    expect(await stored(scheduled.id)).toMatchObject({ status: 'pending' });
    const due = await db.transaction((tx) => listDueScheduledRuns(tx, { limit: 1_000, now: NOW }));
    expect(due.map(({ id }) => id)).toContain(scheduled.id);
  });
});

describe('Schedule Workflow (C118.3)', () => {
  const contextFor = async (
    config: Record<string, unknown>,
    overrides: Partial<ActionContext> = {},
  ): Promise<ActionContext> => {
    const source = await sourceRun();
    return {
      environmentId,
      runId: source,
      depth: 0,
      grant: { scopes: ['workflows:trigger'], pii: false },
      config,
      now: NOW,
      services: { ids: ulidIdGenerator } as unknown as WorkflowServices,
      ...overrides,
    } as unknown as ActionContext;
  };

  const execute = (context: ActionContext) =>
    db.transaction((tx) => SCHEDULE_WORKFLOW_HANDLER.execute(tx, context));

  const SCHEDULE = { offset: 2, units: 'hours', direction: 'after', 'base-time': 'run-time' };

  it('writes the row and says when it runs', async () => {
    const { workflowId } = await target();
    const subjectId = newId('inq');
    const context = await contextFor({
      ...SCHEDULE,
      'workflow-id': workflowId,
      'subject-id': subjectId,
      inputs: { reference: 'synthetic-canary' },
    });

    const result = await execute(context);

    expect(result).toMatchObject({
      kind: 'succeeded',
      output: { 'run-at': '2026-10-20T14:00:00.000Z' },
    });
    const id = (result as unknown as { output: { 'scheduled-run-id': string } }).output[
      'scheduled-run-id'
    ];
    expect(id).toMatch(/^srrun_/);
    const { rows } = await database.client.query<{
      source_run_id: string;
      subject_id: string;
      fire_at: Date;
      offset_unit: string;
      inputs: unknown;
    }>(`select * from scheduled_runs where id = $1`, [id]);
    expect(rows[0]).toMatchObject({
      source_run_id: context.runId,
      subject_id: subjectId,
      offset_unit: 'hours',
    });
    expect(JSON.stringify(rows[0]?.inputs)).not.toContain('synthetic-canary');
  });

  it('reads a date as its base, before or after it', async () => {
    const { workflowId } = await target();
    const context = await contextFor({
      'workflow-id': workflowId,
      'base-time': '2026-11-01T00:00:00.000Z',
      offset: 1,
      units: 'days',
      direction: 'before',
    });

    await expect(execute(context)).resolves.toMatchObject({
      output: { 'run-at': '2026-10-31T00:00:00.000Z' },
    });
  });

  it('refuses a base that is no date', async () => {
    const { workflowId } = await target();
    const context = await contextFor({
      ...SCHEDULE,
      'workflow-id': workflowId,
      'base-time': 'not a date',
    });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'schedule_base_invalid',
    });
  });

  it('refuses a target that is not running', async () => {
    const { workflowId } = await target({ status: 'paused' });
    const context = await contextFor({ ...SCHEDULE, 'workflow-id': workflowId });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'workflow_not_running',
    });
  });

  it('refuses a workflow of another environment (C121.6)', async () => {
    const context = await contextFor({ ...SCHEDULE, 'workflow-id': newId('wfl') });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'workflow_not_running',
    });
  });

  it('refuses at the depth limit (C117.7)', async () => {
    const { workflowId } = await target();
    const context = await contextFor({ ...SCHEDULE, 'workflow-id': workflowId }, { depth: 5 });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'run_depth_exceeded',
    });
  });

  it('refuses a target wider than the run’s grant (C121.3)', async () => {
    const { workflowId } = await target({ grant: { scopes: ['accounts:write'], pii: false } });
    const context = await contextFor({ ...SCHEDULE, 'workflow-id': workflowId });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'run_grant_insufficient',
    });
  });

  it('refuses a target that is no scheduled workflow', async () => {
    const { workflowId } = await target({
      definition: definition({ trigger: { type: 'trigger-api', config: {} } }),
    });
    const context = await contextFor({ ...SCHEDULE, 'workflow-id': workflowId });

    await expect(execute(context)).resolves.toMatchObject({
      kind: 'failed',
      code: 'workflow_trigger_mismatch',
    });
  });
});
