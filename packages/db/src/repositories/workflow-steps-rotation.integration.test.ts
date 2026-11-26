/**
 * C117.8 (Workflow 8D, R004 of the Workflow 8C review) on Postgres 17: the dispatcher's rotation reads
 * one entry per environment with ready work, never the backlog. The query `listEnvironmentsWithReadySteps`
 * sends is captured from the pool and run again under `EXPLAIN (ANALYZE, FORMAT JSON)`; the rows it
 * reads from `workflow_run_steps` stay far below one environment's backlog of ready steps. It still
 * answers only environments with a due, unenqueued step, longest unserved first.
 *
 * Synthetic values only; the steps hold no sealed value, and only ids are read.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../client.js';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { runMigrations } from '../migrate.js';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  seedWorkflowRun,
  startIntegrationPostgres,
  testId,
} from '../testing.js';
import { listEnvironmentsWithReadySteps } from './index.js';

const keyring = createKeyring(randomBytes(32));
/** One environment's backlog: a fan-out of manual runs or a schedule. */
const BACKLOG = 20_000;
/** Far below the backlog, and well above one probe per environment and branch. */
const ROWS_READ_CEILING = 500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
const environments: Record<'backlog' | 'served' | 'fresh' | 'enqueued' | 'future', string> = {
  backlog: '',
  served: '',
  fresh: '',
  enqueued: '',
  future: '',
};

/** `count` ready steps of a new run in `environmentId`, due at `dueAt` (`null`: now), enqueued or not. */
async function readySteps(
  environmentId: string,
  count: number,
  options: { dueAt: string | null; enqueued: boolean },
): Promise<void> {
  const run = await seedWorkflowRun(db, environmentId);
  const ids = Array.from({ length: count }, () => testId('wfst'));
  await pool.query(
    `insert into workflow_run_steps (id, environment_id, run_id, node_id, iteration_path, node_type,
       action_key, action_version, status, due_at, enqueued_at)
     select t.id, $2, $3, 'tag', 'loop[' || t.n || ']/tag', 'action', 'tag_object', 1, 'ready',
       $4::timestamptz, case when $5 then now() else null end
     from unnest($1::text[]) with ordinality as t(id, n)`,
    [ids, environmentId, run.id, options.dueAt, options.enqueued],
  );
}

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  for (const name of Object.keys(environments) as (keyof typeof environments)[]) {
    environments[name] = (await createTestTenant(db)).environment.id;
  }
  await readySteps(environments.backlog, BACKLOG, { dueAt: null, enqueued: false });
  await readySteps(environments.served, 40, { dueAt: null, enqueued: true });
  await readySteps(environments.served, 2, {
    dueAt: '2020-01-01T00:00:00Z',
    enqueued: false,
  });
  await readySteps(environments.fresh, 3, { dueAt: '2020-01-01T00:00:00Z', enqueued: false });
  await readySteps(environments.enqueued, 30, { dueAt: null, enqueued: true });
  await readySteps(environments.future, 30, { dueAt: '2999-01-01T00:00:00Z', enqueued: false });
  await pool.query(
    `insert into queue_slots (environment_id, queue, last_served_at)
     values ($1, 'workflow-step', now()), ($2, 'workflow-step', now() - interval '1 hour')`,
    [environments.backlog, environments.served],
  );
  await pool.query('ANALYZE workflow_run_steps');
  await pool.query('ANALYZE queue_slots');
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

interface PlanNode {
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Plans?: PlanNode[];
}

/** Every row a scan of `relation` produced or threw away, over all its loops. */
function rowsReadFrom(node: PlanNode, relation: string): number {
  const loops = node['Actual Loops'] ?? 1;
  const own =
    node['Relation Name'] === relation
      ? ((node['Actual Rows'] ?? 0) +
          (node['Rows Removed by Filter'] ?? 0) +
          (node['Rows Removed by Index Recheck'] ?? 0)) *
        loops
      : 0;
  return own + (node.Plans ?? []).reduce((sum, child) => sum + rowsReadFrom(child, relation), 0);
}

/** What the last query `run` sent on `workflow_run_steps` read, run again under EXPLAIN ANALYZE. */
async function rowsReadBy(run: () => Promise<unknown>): Promise<{ rows: number; plan: string }> {
  const spy = vi.spyOn(pool, 'query');
  let calls: unknown[][];
  try {
    await run();
  } finally {
    calls = [...spy.mock.calls];
    spy.mockRestore();
  }
  const sent = calls
    .map((call) => {
      const [config, values] = call as unknown as [string | { text: string }, unknown[]?];
      return { text: typeof config === 'string' ? config : config.text, values: values ?? [] };
    })
    .filter(({ text }) => text.includes('workflow_run_steps'))
    .at(-1);
  if (sent === undefined) {
    throw new Error('no query on workflow_run_steps was sent');
  }
  const explained = await pool.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${sent.text}`,
    sent.values,
  );
  const [document] = explained.rows[0]?.['QUERY PLAN'] ?? [];
  if (document === undefined) {
    throw new Error('EXPLAIN answered no plan');
  }
  return {
    rows: rowsReadFrom(document.Plan, 'workflow_run_steps'),
    plan: JSON.stringify(document.Plan),
  };
}

describe('the rotation reads one entry per environment (C117.8, R004)', () => {
  it('answers the environments with due, unenqueued work, longest unserved first', async () => {
    const now = new Date();

    const served = await listEnvironmentsWithReadySteps(db, { now, limit: 500 });

    expect(served).toEqual([environments.fresh, environments.served, environments.backlog]);
  });

  it('honours the limit', async () => {
    const served = await listEnvironmentsWithReadySteps(db, { now: new Date(), limit: 2 });

    expect(served).toEqual([environments.fresh, environments.served]);
  });

  it(`reads far fewer than one environment's ${String(BACKLOG)} ready steps`, async () => {
    const { rows, plan } = await rowsReadBy(() =>
      listEnvironmentsWithReadySteps(db, { now: new Date(), limit: 500 }),
    );

    console.info(
      `the rotation read ${String(rows)} step rows over a backlog of ${String(BACKLOG)}`,
    );
    expect(rows, plan).toBeLessThan(ROWS_READ_CEILING);
  });
});
