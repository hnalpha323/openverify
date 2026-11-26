/**
 * C117.11 (decision 22): re-measures the engine's step transactions on the pinned Postgres image.
 * Reported, not gated. It starts its own Testcontainers Postgres and stops it, and runs the real
 * executor with a handler that does nothing, so what it measures is the engine's own transactions:
 * one claim and one completion per effectful step, and a control-flow node inside the completing
 * transaction.
 *
 *   pnpm --filter @openverify/api exec tsx --conditions=@openverify/source \
 *     scripts/workflow-benchmark.ts [--runs=200] [--clients=1,8,32]
 *
 * Every value is synthetic. Durable commits stay on (decision 17).
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
  type Db,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  seedWorkflow,
  seedWorkflowVersion,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import { createEventPublisher } from '../src/events/index.js';
import { systemClock, ulidIdGenerator, type WorkflowStepJob } from '../src/ports.js';
import { createWebhookDeliveryScheduler } from '../src/webhooks/queue.js';
import { WORKFLOW_ACTIONS } from '../src/workflows/definitions/registry.js';
import {
  createActionHandlerTable,
  type ActionHandler,
} from '../src/workflows/engine/action-port.js';
import type { EngineDeps } from '../src/workflows/engine/deps.js';
import { runStepJob } from '../src/workflows/engine/executor.js';
import { startWorkflowRunInTx, wakeStartedRun } from '../src/workflows/engine/start-run.js';

const argument = (name: string, fallback: string): string =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const RUNS = Number(argument('runs', '200'));
const CLIENTS = argument('clients', '1,8,32').split(',').map(Number);
const STEPS_PER_RUN = 5;
const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const GRANT = { scopes: ['inquiries:write'], pii: false } as const;

const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
    }),
};

const edge = (from: string, to: string) => ({
  id: `${from}-${to}`.replaceAll('_', '-'),
  from,
  'from-port': 'next',
  to,
});

function chainOf(ids: readonly string[], step: (id: string) => Record<string, unknown>) {
  const nodes = ['trigger', ...ids, 'output'];
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-api', config: {} },
    inputs: [],
    variables: [],
    outputs: [],
    layout: {},
    steps: [...ids.map(step), { id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: nodes.slice(1).map((id, index) => edge(nodes[index] ?? 'trigger', id)),
  };
}

const names = (prefix: string) =>
  Array.from({ length: STEPS_PER_RUN }, (_item, index) => `${prefix}_${String(index)}`);

const EFFECTFUL = chainOf(names('tag'), (id) => ({
  id,
  type: 'action',
  name: id,
  'action-key': 'tag_object',
  'action-version': 1,
  config: { 'object-type': 'inquiry', tag: id },
}));

const CONTROL = chainOf(names('count'), (id) => ({
  id,
  type: 'action',
  name: id,
  'action-key': 'calculate',
  'action-version': 1,
  config: { operator: 'add', operands: [1, 2] },
}));

interface Scenario {
  name: string;
  /** Steps each run makes. */
  steps: number;
  definition: unknown;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'effectful', steps: STEPS_PER_RUN, definition: EFFECTFUL },
  { name: 'control-flow', steps: STEPS_PER_RUN, definition: CONTROL },
];

async function publishIn(db: Db, environmentId: string, definition: unknown) {
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition as never,
  });
  return { workflowId: workflow.id, workflowVersionId: version.id };
}

async function measure(db: Db, environmentId: string, scenario: Scenario, clients: number) {
  const jobs: WorkflowStepJob[] = [];
  const deps: EngineDeps = {
    db,
    clock: systemClock,
    ids: ulidIdGenerator,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler({
        add: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    }),
    inFlightCap: 100_000,
    services: {} as never,
    steps: {
      enqueueWorkflowStep: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
    actions: { registry: WORKFLOW_ACTIONS, handlers: createActionHandlerTable([tag]) },
  };
  const published = await publishIn(db, environmentId, scenario.definition);
  let next = 0;
  let open = 0;
  const startedAt = performance.now();
  const worker = async (): Promise<void> => {
    for (;;) {
      const job = jobs.shift();
      if (job !== undefined) {
        await runStepJob(deps, job);
      } else if (next < RUNS) {
        next += 1;
        open += 1;
        const started = await db.transaction((tx) =>
          startWorkflowRunInTx(tx, deps, {
            environmentId,
            ...published,
            triggerType: 'trigger-api',
            creator: { type: 'api-key', id: testId('key') },
            trigger: { id: SUBJECT },
            inputs: {},
            subjectIds: [],
            grant: GRANT,
          }),
        );
        await wakeStartedRun(deps, started);
        open -= 1;
      } else if (open === 0) {
        return;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
  };
  await Promise.all(Array.from({ length: clients }, () => worker()));
  const seconds = (performance.now() - startedAt) / 1_000;
  const steps = RUNS * scenario.steps;
  return {
    scenario: scenario.name,
    clients,
    runs: RUNS,
    steps,
    seconds: Number(seconds.toFixed(2)),
    'steps-per-second': Math.round(steps / seconds),
  };
}

async function main(): Promise<void> {
  const container = await startIntegrationPostgres();
  const pool = createIntegrationPool(container.getConnectionUri(), {
    max: Math.max(...CLIENTS) + 4,
  });
  try {
    const db = createDatabase(pool);
    setDefaultKeyring(createKeyring(randomBytes(32)));
    await runMigrations(db);
    const { environment } = await createTestTenant(db);
    const results = [];
    for (const scenario of SCENARIOS) {
      for (const clients of CLIENTS) {
        results.push(await measure(db, environment.id, scenario, clients));
      }
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } finally {
    await pool.end();
    await container.stop();
  }
}

await main();
