/**
 * Test helpers for the engine, on a real schema. Only tests import this file. Definitions are written
 * by hand, small enough to read, and every handler is a fake, so these suites prove the engine and no
 * action. Every value is synthetic.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  seedWorkflowVersion,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import {
  getWorkflowRun,
  listAllWorkflowRunSteps,
  listWorkflowRunEffects,
  openWorkflowRunValues,
  type Db,
  type WorkflowRunRow,
  type WorkflowRunStepRow,
  type WorkflowStepEffectRow,
} from '@openverify/db';
import { processWorkflowStep } from '../../jobs/workflows/step.js';
import { createEventPublisher, type TransactionalEventPublisher } from '../../events/index.js';
import { ulidIdGenerator } from '../../ports.js';
import {
  createRecordingWorkflowStepQueue,
  createRecordingWorkflowWaitMatchQueue,
  type RecordingWorkflowStepQueue,
  type RecordingWorkflowWaitMatchQueue,
} from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../../webhooks/queue.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import type { WorkflowServices } from '../services.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { createActionHandlerTable, type ActionHandler } from './action-port.js';
import { RUN_WORKFLOW_HANDLER } from './run-workflow.js';
import { startWorkflowRunInTx, wakeStartedRun, type StartWorkflowRunInput } from './start-run.js';
import { engineDepsOf } from './worker-deps.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

export const FULL_GRANT = {
  scopes: ['inquiries:write', 'accounts:write', 'reports:write', 'workflows:trigger'],
  pii: true,
} as const;

export interface EngineHarness {
  database: TestDatabase;
  db: Db;
  environmentId: string;
  organizationId: string;
  deps: WorkflowWorkerDeps;
  events: TransactionalEventPublisher;
  steps: RecordingWorkflowStepQueue;
  waitMatches: RecordingWorkflowWaitMatchQueue;
  close(): Promise<void>;
}

/** The harness on any database: PGlite for the suites, Postgres for the races. */
export function createEngineHarnessOnDatabase(
  db: Db,
  tenant: { environment: { id: string }; organization: { id: string } },
  handlers: readonly ActionHandler[],
  database: TestDatabase = {
    db,
    client: {
      query: async (text: string, params: unknown[] = []) => {
        const { sql } = await import('drizzle-orm');
        const parts = text.split(/\$\d+/);
        const indexes = [...text.matchAll(/\$(\d+)/g)].map(([, n]) => Number(n) - 1);
        const statement = sql.join(
          parts.flatMap((part, position) =>
            position < indexes.length
              ? [sql.raw(part), sql`${params[indexes[position] ?? 0]}`]
              : [sql.raw(part)],
          ),
        );
        return db.execute(statement);
      },
    },
    close: () => Promise.resolve(),
  } as never,
): EngineHarness {
  const steps = createRecordingWorkflowStepQueue();
  const waitMatches = createRecordingWorkflowWaitMatchQueue();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler({
      add: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }),
    workflowSteps: waitMatches,
  });
  const services = {
    db,
    events,
    ids: ulidIdGenerator,
    audit: { record: () => Promise.resolve() },
  } as unknown as WorkflowServices;
  const deps: WorkflowWorkerDeps = {
    db,
    clock: { now: () => new Date() },
    logger: silent,
    services,
    steps,
    triggers: { enqueueWorkflowTrigger: () => Promise.resolve() },
    waitMatches,
    actions: {
      registry: WORKFLOW_ACTIONS,
      handlers: createActionHandlerTable([RUN_WORKFLOW_HANDLER, ...handlers]),
    },
  };
  return {
    database,
    db,
    environmentId: tenant.environment.id,
    organizationId: tenant.organization.id,
    deps,
    events,
    steps,
    waitMatches,
    close: () => database.close(),
  };
}

export async function createEngineHarness(
  handlers: readonly ActionHandler[],
  options: { environmentKind?: 'sandbox' | 'production' } = {},
): Promise<EngineHarness> {
  const database = await createTestDatabase();
  const tenant = await createTestTenant(database.db, {
    kind: options.environmentKind ?? 'sandbox',
  });
  return createEngineHarnessOnDatabase(database.db, tenant, handlers, database);
}

/** A second tenant on the same database, with its own producers but for the step queue. */
export async function createEngineHarnessOn(first: EngineHarness): Promise<EngineHarness> {
  const tenant = await createTestTenant(first.db, { kind: 'sandbox' });
  return {
    ...first,
    environmentId: tenant.environment.id,
    organizationId: tenant.organization.id,
  };
}

export const EMPTY: Omit<WorkflowDefinition, 'steps' | 'edges'> = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  outputs: [],
  layout: {},
} as never;

/** An edge, with the ports a chain uses. */
export const edge = (from: string, to: string, port = 'next') => ({
  id: `${from}-${port.replace(':', '-')}-${to}`.toLowerCase(),
  from,
  'from-port': port,
  to,
});

export const action = (
  id: string,
  actionKey: string,
  config: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
) => ({
  id,
  type: 'action',
  name: id,
  'action-key': actionKey,
  'action-version': 1,
  config,
  ...more,
});

export const output = (mappings: Record<string, unknown> = {}) => ({
  id: 'output',
  type: 'output',
  name: 'Output',
  mappings,
});

/** `trigger -> a -> b -> output`, from the steps given. */
export function chain(
  steps: readonly Record<string, unknown>[],
  more: Partial<Record<keyof WorkflowDefinition, unknown>> = {},
): WorkflowDefinition {
  const ids = ['trigger', ...steps.map(({ id }) => String(id)), 'output'];
  return {
    ...EMPTY,
    steps: [...steps, output()],
    edges: ids.slice(1).map((id, index) => edge(ids[index] ?? 'trigger', id)),
    ...more,
  } as unknown as WorkflowDefinition;
}

export function definitionOf(
  steps: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
  more: Partial<Record<keyof WorkflowDefinition, unknown>> = {},
): WorkflowDefinition {
  return { ...EMPTY, steps, edges, ...more } as unknown as WorkflowDefinition;
}

export async function publish(
  harness: EngineHarness,
  definition: WorkflowDefinition,
  options: { kind?: string; status?: string; id?: string } = {},
): Promise<{ workflowId: string; workflowVersionId: string }> {
  const { environmentId, db } = harness;
  const workflow = await seedWorkflow(db, environmentId, {
    kind: options.kind ?? 'workflow',
    status: options.status ?? 'running',
    ...(options.id === undefined ? {} : { id: options.id }),
  });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition,
  });
  return { workflowId: workflow.id, workflowVersionId: version.id };
}

export async function start(
  harness: EngineHarness,
  definition: WorkflowDefinition,
  input: Partial<StartWorkflowRunInput> = {},
): Promise<string> {
  const published = await publish(harness, definition);
  return startOf(harness, published, input);
}

export async function startOf(
  harness: EngineHarness,
  published: { workflowId: string; workflowVersionId: string },
  input: Partial<StartWorkflowRunInput> = {},
): Promise<string> {
  const { environmentId, db, deps } = harness;
  const engine = engineDepsOf(deps);
  const started = await db.transaction((tx) =>
    startWorkflowRunInTx(tx, engine, {
      environmentId,
      ...published,
      triggerType: 'trigger-api',
      creator: { type: 'api-key', id: testId('key') },
      trigger: { id: 'inq_01M5CK16P0D13FXHZSS4TCFBVH', status: 'completed' },
      inputs: {},
      subjectIds: [],
      grant: FULL_GRANT,
      ...input,
    }),
  );
  await wakeStartedRun(engine, started);
  return started.run.id;
}

/** Plays every job the queue holds, and every job those make, as the workers would. */
export async function drain(harness: EngineHarness, limit = 500): Promise<void> {
  const { steps, deps } = harness;
  for (let turn = 0; turn < limit; turn += 1) {
    const next = steps.jobs.shift();
    if (next === undefined) {
      return;
    }
    await processWorkflowStep(next.job, deps);
  }
  throw new Error('the queue never drained');
}

export const runOf = async (harness: EngineHarness, id: string): Promise<WorkflowRunRow> => {
  const run = await getWorkflowRun(harness.db, harness.environmentId, id);
  if (run === null) {
    throw new Error('no run');
  }
  return run;
};

export const outputsOf = async (harness: EngineHarness, id: string) =>
  openWorkflowRunValues(await runOf(harness, id)).outputs;

export const stepsOf = (harness: EngineHarness, id: string): Promise<WorkflowRunStepRow[]> =>
  listAllWorkflowRunSteps(harness.db, harness.environmentId, id);

export const stepOf = async (
  harness: EngineHarness,
  id: string,
  nodeId: string,
  iterationPath = '',
): Promise<WorkflowRunStepRow> => {
  const found = (await stepsOf(harness, id)).find(
    (step) => step.nodeId === nodeId && step.iterationPath === iterationPath,
  );
  if (found === undefined) {
    throw new Error(`no step ${nodeId}`);
  }
  return found;
};

export const effectsOf = (harness: EngineHarness, id: string): Promise<WorkflowStepEffectRow[]> =>
  listWorkflowRunEffects(harness.db, harness.environmentId, id);

export async function journalOf(harness: EngineHarness, id: string): Promise<string[]> {
  const rows = await harness.database.client.query<{ kind: string; node_id: string | null }>(
    'select kind, node_id from workflow_run_journal where run_id = $1 order by id',
    [id],
  );
  return rows.rows.map(({ kind, node_id: node }) => (node === null ? kind : `${kind}:${node}`));
}

export async function eventNames(harness: EngineHarness, runId: string): Promise<string[]> {
  const rows = await harness.database.client.query<{ name: string }>(
    `select name from events where environment_id = $1 order by created_at, id`,
    [harness.environmentId],
  );
  return runId === '' ? [] : rows.rows.map(({ name }) => name);
}

/** A handler that answers what `answers` says, by node, and counts its calls. */
export function scripted(
  key: string,
  shape: 'transaction' | 'outside',
  answer: (nodeId: string, call: number) => Parameters<typeof Promise.resolve>[0],
): ActionHandler & { calls: string[] } {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const run = (nodeId: string) => {
    calls.push(nodeId);
    const call = (counts.get(nodeId) ?? 0) + 1;
    counts.set(nodeId, call);
    return Promise.resolve(answer(nodeId, call)) as never;
  };
  return shape === 'transaction'
    ? {
        key,
        version: 1,
        shape,
        calls,
        execute: (_tx, context) => run(context.nodeId),
      }
    : {
        key,
        version: 1,
        shape,
        calls,
        execute: (context) => run(context.nodeId),
      };
}
