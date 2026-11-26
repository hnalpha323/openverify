/**
 * C118.4: each tick starts one run per matching object, oldest first, and keeps a cursor; an outage
 * gives one catch-up tick, and the fire key makes a repeated tick start nothing twice. The engine's
 * start is faked, and `start-run` tests prove it. Every value is synthetic.
 */
import { newId, type WorkflowDefinition } from '@openverify/contracts';
import { listDueWorkflowSchedules, replaceWorkflowSchedule, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createdAtClock,
  seedWorkflow,
  seedWorkflowVersion,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import type { RateLimiter } from '../../ports.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import type { WorkflowServices } from '../services.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { tickWorkflowSchedule } from './schedules.js';

const engine = vi.hoisted(() => ({ start: vi.fn(), wake: vi.fn() }));
vi.mock('../engine/start-run.js', () => ({
  startWorkflowRunInTx: engine.start,
  wakeStartedRun: engine.wake,
}));

const NOW = new Date('2026-10-20T12:00:30.000Z');
const FIRE = new Date('2026-10-20T12:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;
let rateLimiter: RateLimiter;
let logger: ReturnType<typeof createCapturingLogger>;

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
  logger = createCapturingLogger();
  engine.start.mockReset();
  engine.start.mockImplementation(() =>
    Promise.resolve({ run: { id: newId('wfr') }, created: true, after: {} }),
  );
});

const deps = () =>
  ({
    db,
    clock: { now: () => NOW },
    logger,
    services: { rateLimiter } as unknown as WorkflowServices,
    steps: { enqueueWorkflowStep: () => Promise.resolve() },
  }) as unknown as WorkflowWorkerDeps;

const definition = (config: Record<string, unknown> = {}): WorkflowDefinition =>
  ({
    'schema-version': 1,
    trigger: {
      type: 'trigger-recurring',
      config: { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'inquiry', ...config },
    },
    inputs: [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  }) as unknown as WorkflowDefinition;

async function scheduled(
  options: {
    config?: Record<string, unknown>;
    status?: string;
    objectType?: 'inquiry' | 'case';
    nextFireAt?: Date;
    batchCap?: number;
    filter?: Record<string, unknown> | null;
    onNull?: string | null;
    cron?: string;
  } = {},
) {
  const workflow = await seedWorkflow(db, environmentId, { status: options.status ?? 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition(options.config),
  });
  await database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  await replaceWorkflowSchedule(db, environmentId, workflow.id, {
    id: newId('wfsc'),
    workflowId: workflow.id,
    cron: options.cron ?? null,
    everyMinutes: options.cron === undefined ? 60 : null,
    timeZone: 'UTC',
    objectType: options.objectType ?? 'inquiry',
    filter: options.filter ?? null,
    onNull: options.onNull ?? null,
    batchCap: options.batchCap ?? 100,
    nextFireAt: options.nextFireAt ?? FIRE,
  });
  return { workflowId: workflow.id, versionId: version.id };
}

async function due(workflowId: string) {
  const rows = await db.transaction((tx) =>
    listDueWorkflowSchedules(tx, { limit: 1_000, now: new Date('2030-01-01T00:00:00.000Z') }),
  );
  const row = rows.find((schedule) => schedule.workflowId === workflowId);
  if (row === undefined) {
    throw new Error('no schedule');
  }
  return row;
}

async function inquiries(count: number): Promise<string[]> {
  const clock = createdAtClock(db, new Date('2026-10-01T00:00:00.000Z'));
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const { inquiry } = await createTestInquiry(db, environmentId);
    await clock.at('inquiries', inquiry.id);
    ids.push(inquiry.id);
  }
  return ids;
}

const tick = async (workflowId: string, now = NOW) => {
  const schedule = await due(workflowId);
  return db.transaction((tx) => tickWorkflowSchedule(tx, deps(), schedule, now));
};

const started = () =>
  engine.start.mock.calls.map(([, , input]) => input as Record<string, unknown>);

describe('a tick (C118.4)', () => {
  it('starts one run per object, oldest first, each with its own fire key', async () => {
    const ids = await inquiries(2);
    const { workflowId, versionId } = await scheduled();

    const runs = await tick(workflowId);

    expect(runs).toHaveLength(2);
    const schedule = await due(workflowId);
    expect(started().map((input) => input.scheduleFire)).toEqual(
      ids.map((id) => `${schedule.id}/${FIRE.toISOString()}/${id}`),
    );
    expect(started()[0]).toMatchObject({
      workflowId,
      workflowVersionId: versionId,
      triggerType: 'trigger-recurring',
      creator: null,
      subjectIds: [ids[0]],
    });
    expect(started()[0]?.trigger).toMatchObject({ type: 'inquiry', id: ids[0] });
  });

  it('moves to the next fire and stamps the last, with no cursor when it read everything', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled();

    await tick(workflowId);

    expect(await due(workflowId)).toMatchObject({
      nextFireAt: new Date('2026-10-20T13:00:30.000Z'),
      lastFiredAt: FIRE,
      cursor: null,
    });
  });

  it('stops at its batch cap, keeps a cursor, and the next tick goes on from it', async () => {
    const ids = await inquiries(3);
    const { workflowId } = await scheduled({ batchCap: 2 });

    await tick(workflowId);

    expect((await due(workflowId)).cursor).toBe(ids[1]);
    engine.start.mockClear();

    await tick(workflowId, new Date('2026-10-20T13:00:31.000Z'));

    expect(started().map((input) => input.subjectIds)).toEqual([[ids[2]]]);
    expect((await due(workflowId)).cursor).toBeNull();
  });

  it('gives one catch-up tick after an outage (C74.3 (b))', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled({
      nextFireAt: new Date('2026-10-20T03:00:00.000Z'),
    });

    await tick(workflowId);

    expect(engine.start).toHaveBeenCalledTimes(1);
    expect((await due(workflowId)).nextFireAt).toEqual(new Date('2026-10-20T13:00:30.000Z'));
  });

  it('starts nothing for a paused workflow, and moves on', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled({ status: 'paused' });

    await tick(workflowId);

    expect(engine.start).not.toHaveBeenCalled();
    expect((await due(workflowId)).nextFireAt).toEqual(new Date('2026-10-20T13:00:30.000Z'));
  });

  it('starts nothing for an object type Workflow 8B builds', async () => {
    const { workflowId } = await scheduled({ objectType: 'case' });

    await expect(tick(workflowId)).resolves.toEqual([]);
  });

  it('counts only the runs it made, so a repeated tick starts nothing twice', async () => {
    await inquiries(2);
    engine.start.mockResolvedValue({ run: { id: newId('wfr') }, created: false, after: {} });
    const { workflowId } = await scheduled();

    await expect(tick(workflowId)).resolves.toEqual([]);
  });

  it('takes an object the filter admits, and leaves the rest (C114.6)', async () => {
    const ids = await inquiries(2);
    const { workflowId } = await scheduled({
      filter: { '===': [{ var: 'trigger.id' }, ids[1]] },
    });

    await tick(workflowId);

    expect(started().map((input) => input.subjectIds)).toEqual([[ids[1]]]);
  });

  it('follows on-null: admit and skip', async () => {
    await inquiries(1);
    const nullable = { '===': [{ var: 'trigger.reference-id' }, 'ref'] };
    const admitted = await scheduled({ filter: nullable, onNull: 'admit' });
    const skipped = await scheduled({ filter: nullable, onNull: 'skip' });

    await tick(admitted.workflowId);
    expect(engine.start).toHaveBeenCalledTimes(1);
    engine.start.mockClear();

    await tick(skipped.workflowId);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('leaves an object whose filter errors, with its code in the log, and never a value', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled({
      filter: { '===': [{ var: 'trigger.reference-id' }, 'ref'] },
      onNull: 'error',
    });

    await tick(workflowId);

    expect(engine.start).not.toHaveBeenCalled();
    expect(logger.entries.map(({ object }) => object.reason)).toContain('condition_input_null');
    expect(JSON.stringify(logger.entries)).not.toContain('reference-id');
  });

  it('stops at the run limiter, and the next tick goes on from the cursor (C117.8)', async () => {
    const ids = await inquiries(2);
    const { workflowId } = await scheduled();
    let calls = 0;
    const allow = createAllowAllRateLimiter();
    rateLimiter = {
      consume: async (key, rule) => {
        calls += 1;
        const decision = await allow.consume(key, rule);
        return calls === 1 ? decision : { ...decision, allowed: false, retryAfterSeconds: 5 };
      },
    };

    await tick(workflowId);

    expect(started().map((input) => input.subjectIds)).toEqual([[ids[0]]]);
    expect((await due(workflowId)).cursor).toBe(ids[0]);
  });

  it('skips nothing when the limiter is down: it stops, and never fails open (P31)', async () => {
    const ids = await inquiries(1);
    const { workflowId } = await scheduled();
    rateLimiter = { consume: () => Promise.reject(new Error('down')) };

    await tick(workflowId);

    expect(engine.start).not.toHaveBeenCalled();
    expect((await due(workflowId)).cursor).toBeNull();
    expect(ids).toHaveLength(1);
  });

  it('leaves a schedule that is not due alone', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled({ nextFireAt: new Date(NOW.getTime() + 1_000) });

    await expect(tick(workflowId)).resolves.toEqual([]);

    expect(engine.start).not.toHaveBeenCalled();
    expect((await due(workflowId)).lastFiredAt).toBeNull();
  });

  it('moves a schedule it cannot read on by a day, rather than fire it every sweep', async () => {
    await inquiries(1);
    const { workflowId } = await scheduled({ cron: 'not a cron' });

    await tick(workflowId);

    expect(engine.start).not.toHaveBeenCalled();
    expect((await due(workflowId)).nextFireAt).toEqual(new Date('2026-10-21T12:00:30.000Z'));
  });

  it('leaves a schedule whose version it cannot read, and moves on', async () => {
    await inquiries(1);
    const { workflowId, versionId } = await scheduled();
    await database.client.query(
      `update workflow_versions set definition = '{}'::jsonb where id = $1`,
      [versionId],
    );

    await tick(workflowId);

    expect(engine.start).not.toHaveBeenCalled();
    expect((await due(workflowId)).nextFireAt).toEqual(new Date('2026-10-20T13:00:30.000Z'));
  });
});
