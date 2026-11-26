/**
 * C146.2 on Postgres 17 row locks (Testcontainers): a fan-out starts exactly one run per event and
 * workflow under repeated jobs, and two sweepers share a tick and a scheduled run without doubling
 * either. A Valkey that is down at the commit delays a delivery and never loses it. Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import { buildInquiryResource, newId, type WorkflowDefinition } from '@openverify/contracts';
import {
  createDatabase,
  createEvent,
  createKeyring,
  createScheduledRun,
  createWorkflowDeliveries,
  listWorkflowDeliveries,
  replaceWorkflowSchedule,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowVersion,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runScheduledRunsSweep,
  runWorkflowScheduleSweep,
} from '../../jobs/repeatable/workflows.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import { createEngineHarnessOnDatabase, type EngineHarness } from '../engine/testing.js';
import { processWorkflowTrigger } from './deliver.js';

const keyring = createKeyring(randomBytes(32));

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let harness: EngineHarness;

const outputOnly = (trigger: unknown): WorkflowDefinition =>
  ({
    'schema-version': 1,
    trigger,
    inputs: [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  }) as unknown as WorkflowDefinition;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  harness = createEngineHarnessOnDatabase(db, tenant, []);
  (harness.deps.services as unknown as { rateLimiter: unknown }).rateLimiter =
    createAllowAllRateLimiter();
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

async function live(definition: WorkflowDefinition) {
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition,
  });
  await db.execute(
    sql`update workflows set latest_published_version_id = ${version.id} where id = ${workflow.id}`,
  );
  await db.execute(
    sql`update workflow_versions set published_at = '2026-01-01T00:00:00Z' where id = ${version.id}`,
  );
  return { workflowId: workflow.id, versionId: version.id };
}

const count = async (query: ReturnType<typeof sql>): Promise<number> => {
  const { rows } = (await db.execute(query)) as unknown as { rows: { count: string }[] };
  return Number(rows[0]?.count ?? 0);
};

const at = new Date('2026-10-20T12:00:00.000Z');

async function delivered(workflowId: string) {
  const eventId = newId('evt');
  await createEvent(db, environmentId, {
    id: eventId,
    name: 'inquiry.completed',
    payload: {
      data: buildInquiryResource({
        id: newId('inq'),
        status: 'completed',
        referenceId: null,
        fields: {},
        inquiryTemplateId: newId('itmpl'),
        verifications: [],
        createdAt: at,
        updatedAt: at,
      }),
    },
  });
  const id = newId('wftd');
  await createWorkflowDeliveries(db, environmentId, [
    { id, eventId, eventName: 'inquiry.completed', workflowId },
  ]);
  return id;
}

const EVENT_TRIGGER = { type: 'trigger-event', config: { events: ['inquiry.completed'] } };

describe('a delivery under repeated jobs (C118.1, C146.2)', () => {
  it('starts exactly one run, however many workers take it at once', async () => {
    const { workflowId } = await live(outputOnly(EVENT_TRIGGER));
    const deliveryId = await delivered(workflowId);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        processWorkflowTrigger({ environmentId, deliveryId }, harness.deps),
      ),
    );

    await expect(
      count(sql`select count(*) from workflow_runs where workflow_id = ${workflowId}`),
    ).resolves.toBe(1);
    const { items } = await listWorkflowDeliveries(
      db,
      environmentId,
      { workflowIds: [workflowId] },
      {},
    );
    expect(items[0]?.status).toBe('run_created');
  });

  it('delays a delivery when Valkey is down, and starts it once Valkey is back', async () => {
    const { workflowId } = await live(outputOnly(EVENT_TRIGGER));
    const deliveryId = await delivered(workflowId);
    const services = harness.deps.services as unknown as { rateLimiter: unknown };
    const working = services.rateLimiter;
    services.rateLimiter = { consume: () => Promise.reject(new Error('valkey is down')) };

    await processWorkflowTrigger({ environmentId, deliveryId }, harness.deps);

    const { items } = await listWorkflowDeliveries(
      db,
      environmentId,
      { workflowIds: [workflowId] },
      {},
    );
    expect(items[0]?.status).toBe('pending');
    services.rateLimiter = working;
    await db.execute(
      sql`update workflow_trigger_deliveries set not_before = null where id = ${deliveryId}`,
    );

    await processWorkflowTrigger({ environmentId, deliveryId }, harness.deps);

    await expect(
      count(sql`select count(*) from workflow_runs where workflow_id = ${workflowId}`),
    ).resolves.toBe(1);
  });
});

describe('two sweepers (C118.3, C118.4)', () => {
  it('start one run per object of a tick', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push((await createTestInquiry(db, environmentId)).inquiry.id);
    }
    const { workflowId } = await live(
      outputOnly({
        type: 'trigger-recurring',
        config: { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'inquiry' },
      }),
    );
    await replaceWorkflowSchedule(db, environmentId, workflowId, {
      id: newId('wfsc'),
      workflowId,
      cron: null,
      everyMinutes: 60,
      timeZone: 'UTC',
      objectType: 'inquiry',
      filter: null,
      onNull: null,
      batchCap: 100,
      nextFireAt: new Date(Date.now() - 1_000),
    });

    await Promise.all([
      runWorkflowScheduleSweep(harness.deps),
      runWorkflowScheduleSweep(harness.deps),
    ]);

    await expect(
      count(sql`select count(*) from workflow_runs where workflow_id = ${workflowId}`),
    ).resolves.toBeGreaterThanOrEqual(ids.length);
    await expect(
      count(sql`
        select count(*) from (
          select schedule_fire from workflow_runs where workflow_id = ${workflowId}
          group by schedule_fire having count(*) > 1) as repeated`),
    ).resolves.toBe(0);
  });

  it('start a scheduled run once', async () => {
    const source = await live(outputOnly({ type: 'trigger-api', config: {} }));
    const run = await seedWorkflowRun(db, environmentId, {
      workflowId: source.workflowId,
      workflowVersionId: source.versionId,
    });
    const { workflowId } = await live(outputOnly({ type: 'trigger-schedule', config: {} }));
    await db.execute(
      sql`update workflow_versions set "grant" = '{"scopes": [], "pii": false}'::jsonb
          where workflow_id = ${workflowId}`,
    );
    await createScheduledRun(db, environmentId, {
      id: newId('srrun'),
      targetWorkflowId: workflowId,
      sourceRunId: run.id,
      subjectId: null,
      baseAt: new Date(),
      offsetValue: 1,
      offsetUnit: 'minutes',
      offsetDirection: 'before',
      fireAt: new Date(Date.now() - 1_000),
      inputs: null,
    });

    await Promise.all([runScheduledRunsSweep(harness.deps), runScheduledRunsSweep(harness.deps)]);

    await expect(
      count(sql`select count(*) from workflow_runs where workflow_id = ${workflowId}`),
    ).resolves.toBe(1);
  });
});
