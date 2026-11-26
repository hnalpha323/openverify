/**
 * C132.3, C133.6 (Workflow 8B Stage 3, `api-queues-sla`) on Postgres 17:
 * - The pull (`POST /cases/next`) reads `cases_pull_idx`: the plan Postgres chooses (EXPLAIN) for the
 *   exact query `pullNextCaseId` sends, captured from the pool, over tens of thousands of analysed
 *   cases of which few wait unassigned, names the index.
 * - Two pulls at once take two different cases: the first holds its case `FOR UPDATE`, and the second
 *   skips it (`SKIP LOCKED`) instead of waiting or taking it too.
 * - Two `case-sla` sweepers at once take disjoint due rows, so no deadline is expired twice.
 *
 * Synthetic values only; the filler rows hold no readable sealed value, and only ids are read.
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
  seedCaseQueue,
  seedCaseTemplate,
  startIntegrationPostgres,
  testId,
} from '../testing.js';
import { lockDueCaseSlas, pullNextCaseId } from './index.js';

const keyring = createKeyring(randomBytes(32));
const FILLER_ROWS = 30_000;
/** One filler case in a hundred waits unassigned; the rest are assigned or resolved. */
const WAITING_EVERY = 100;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let queues: string[];
const reader = { kind: 'user' as const, userId: testId('usr') };

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 6 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  environmentId = (await createTestTenant(db)).environment.id;
  const template = await seedCaseTemplate(db, environmentId, { key: 'PULL' });
  queues = [
    (await seedCaseQueue(db, environmentId)).id,
    (await seedCaseQueue(db, environmentId)).id,
    (await seedCaseQueue(db, environmentId)).id,
  ];
  const ids = Array.from({ length: FILLER_ROWS }, () => testId('case'));
  const assignee = testId('usr');
  await pool.query(
    `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
       status, status_category, creator_type, creator_id, fields, case_queue_id, assignee_id,
       assigner_type, assigner_id, assigned_at, sla_state, sla_epoch, sla_target_ms,
       sla_segment_started_at, sla_expires_at, created_at)
     select t.id, $2, $3, $4, 'PULL-' || t.n, 'open', 'initial', 'user', $5, 'filler',
       ($6::text[])[1 + t.n % 3],
       case when t.n % ${String(WAITING_EVERY)} = 0 then null else $5 end,
       case when t.n % ${String(WAITING_EVERY)} = 0 then null else 'user' end,
       case when t.n % ${String(WAITING_EVERY)} = 0 then null else $5 end,
       case when t.n % ${String(WAITING_EVERY)} = 0 then null else now() end,
       case when t.n % 7 = 0 then 'running' else 'none' end,
       case when t.n % 7 = 0 then 1 else 0 end,
       case when t.n % 7 = 0 then 3600000 else null end,
       case when t.n % 7 = 0 then now() else null end,
       case when t.n % 7 = 0 then now() + make_interval(mins => (t.n % 500)::int) else null end,
       now() - make_interval(secs => t.n::double precision)
     from unnest($1::text[]) with ordinality as t(id, n)`,
    [ids, environmentId, template.id, template.versionId, assignee, queues],
  );
  await pool.query('ANALYZE cases');
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

/** The last query `run` sent on `cases`, with its parameters. */
async function sentBy(run: () => Promise<unknown>): Promise<{ text: string; values: unknown[] }> {
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
    .filter(({ text }) => text.includes('from "cases"'))
    .at(-1);
  if (sent === undefined) {
    throw new Error('no query on cases was sent');
  }
  return sent;
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];

/**
 * The rows the executed plan read from `cases` (returned and filtered out, over every loop), and
 * the indexes it read them through, in a transaction that is rolled back.
 */
async function rowsRead(sent: { text: string; values: unknown[] }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const explained = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${sent.text}`,
      sent.values,
    );
    const [root] = explained.rows[0]?.['QUERY PLAN'] ?? [];
    const scans =
      root === undefined
        ? []
        : nodesOf(root.Plan).filter((node) => node['Relation Name'] === 'cases');
    return {
      rows: scans.reduce(
        (sum, node) =>
          sum +
          ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) *
            (node['Actual Loops'] ?? 1),
        0,
      ),
      indexes: [...new Set(scans.map((node) => node['Index Name'] ?? node['Node Type']))],
    };
  } finally {
    await client.query('rollback');
    client.release();
  }
}

/**
 * Workflow 8C review R008 (Workflow 8D): a pull reads, from each of its queues, the most urgent case
 * it can lock and no more, so its cost does not grow with a queue's backlog. The budget is ours: one
 * row a queue, with nothing locked by another pull.
 */
const PULL_ROWS_PER_QUEUE = 1;

describe('the pull reads cases_pull_idx (C132.3)', () => {
  it.each([
    ['one queue', () => [queues[0] ?? '']],
    ['three queues', () => queues],
  ] as const)('for %s', async (_name, of) => {
    // Outside a transaction, so the query goes through `pool.query`, where it is captured.
    const sent = await sentBy(() => pullNextCaseId(db, environmentId, of(), reader));
    const explained = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${sent.text}`,
      sent.values,
    );
    const plan = explained.rows.map((row) => row['QUERY PLAN']).join('\n');

    console.info(`EXPLAIN the pull over ${String(FILLER_ROWS)} cases:\n${plan}`);
    expect(plan).toContain('cases_pull_idx');
    expect(plan).toContain('LockRows');
  });

  it.each([
    ['one queue', () => [queues[0] ?? '']],
    ['three queues', () => queues],
  ] as const)(
    'reads at most one case a queue for %s, whatever its backlog (R008)',
    async (_name, of) => {
      const queueIds = of();
      const sent = await sentBy(() => pullNextCaseId(db, environmentId, queueIds, reader));

      const read = await rowsRead(sent);

      expect(read.indexes).toEqual(['cases_pull_idx']);
      expect(read.rows).toBeLessThanOrEqual(PULL_ROWS_PER_QUEUE * queueIds.length);
    },
  );
});

/** A transaction that holds its first pick until `release` is called. */
function holding<T>(take: (tx: Database) => Promise<T>) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let picked: (value: T) => void = () => undefined;
  const pick = new Promise<T>((resolve) => {
    picked = resolve;
  });
  const done = db.transaction(async (tx) => {
    picked(await take(tx as unknown as Database));
    await released;
  });
  return { pick, release, done };
}

describe('two at once never take one row (C132.3, C133.6)', () => {
  it('a second pull skips the case the first holds', async () => {
    const first = holding((tx) => pullNextCaseId(tx, environmentId, queues, reader));
    const held = await first.pick;

    const second = await db.transaction((tx) => pullNextCaseId(tx, environmentId, queues, reader));
    first.release();
    await first.done;

    expect(held).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(held);
  });

  it('two sweepers lock disjoint due SLAs', async () => {
    const now = new Date(Date.now() + 600 * 60_000);
    const first = holding((tx) => lockDueCaseSlas(tx, { now, limit: 50 }));
    const taken = await first.pick;

    const second = await db.transaction((tx) => lockDueCaseSlas(tx, { now, limit: 50 }));
    first.release();
    await first.done;

    const firstIds = new Set(taken.map(({ caseId }) => caseId));
    expect(taken).toHaveLength(50);
    expect(second).toHaveLength(50);
    expect(second.filter(({ caseId }) => firstIds.has(caseId))).toEqual([]);
  });
});
