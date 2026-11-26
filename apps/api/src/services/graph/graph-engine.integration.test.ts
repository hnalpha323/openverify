/**
 * C102.8 (Workflow 7B, `api-graph`) against Postgres 17 (Testcontainers, started without
 * bind-parameter logging), on a synthetic graph of 100,000 accounts (`synthetic.ts`, the
 * benchmark's builder): the hop and node caps, hub skipping through the capped count, the deadline
 * (`timed_out` with what was gathered), the synchronous cap, weak kinds left out without the flag,
 * no value or key in a node id, `index-complete: false` during a backfill, a redacted account gone
 * from a stored result, and a cancel racing a completion (the row lock decides, both orders).
 *
 * Budget (CI): the 100,000-account graph (the strong kinds the cases read for every account, IP
 * addresses for 20,000 of them, and the hub: 225,000 rows) is built once, before the run's files
 * start, into a template database by the `graph` project's global setup
 * (`vitest.graph-template.ts`, owner decision 17 after Workflow 7B), within the same 180 s guard;
 * this file's hook copies it (about 2 s alone) within its 180 s guard, and each case runs within
 * the 60 s test guard (7 to 71 ms a search, 522 ms for each race with its 500 ms wait). Every value
 * key is a hash of a seed: no value, no person.
 */
import { randomBytes } from 'node:crypto';
import { newId, type GraphQueryTemplateConfig } from '@openverify/contracts';
import {
  createDatabase,
  createGraphQuery,
  createKeyring,
  getGraphQuery,
  lockGraphQuery,
  markGraphKindsIncomplete,
  setDefaultKeyring,
  setGraphQueryStart,
  storeGraphQueryResult,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  seedGraphQueryTemplate,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { processGraphQuery } from '../../jobs/graph/query.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { kindsNotIndexedFor } from './queries.js';
import { newGraphNodeId, searchGraph, synchronousClaim, type GraphSearchPlan } from './query.js';
import { redactAccountGraphInTx } from './redaction.js';
import { syntheticAccountId, syntheticValueKey } from './synthetic.js';

/** The graph the run's global setup built into its template database (`vitest.graph-template.ts`). */
const template = inject('graphTemplate');
const ACCOUNTS = template.accounts;
const SEED = template.seed;
const WAIT_MS = 500;

let pool: Pool | undefined;
let db: Database;
let environmentId: string;

/** `connectionUri` naming `database` instead. */
const uriOf = (connectionUri: string, database: string) => {
  const url = new URL(connectionUri);
  url.pathname = `/${database}`;
  return url.toString();
};

beforeAll(async () => {
  const started = Date.now();
  // A fresh copy of the built graph: the cases write to it (a redaction, stored results).
  const database = `graph_engine_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: template.adminUri });
  await admin.connect();
  try {
    await admin.query(`create database ${database} template ${template.database}`);
  } finally {
    await admin.end();
  }
  pool = createIntegrationPool(uriOf(template.adminUri, database), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  environmentId = template.environmentId;
  process.stderr.write(
    `graph-engine: database copied from the template in ${String(Date.now() - started)} ms\n`,
  );
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await pool?.end();
});

/** The pool, once `beforeAll` made it. */
const connect = () => {
  if (pool === undefined) {
    throw new Error('graph-engine: no database (beforeAll failed)');
  }
  return pool.connect();
};

const config = (overrides: Partial<GraphQueryTemplateConfig> = {}): GraphQueryTemplateConfig => ({
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
  'max-hops': 4,
  'node-limit': 2000,
  ...overrides,
});

const plan = (overrides: Partial<GraphSearchPlan> = {}): GraphSearchPlan => ({
  environmentId,
  config: config(),
  startAccounts: [syntheticAccountId(50_000)],
  startValues: [],
  filters: {},
  deadline: Date.now() + 30_000,
  ...overrides,
});

const search = (overrides: Partial<GraphSearchPlan> = {}) =>
  searchGraph(db, plan(overrides), { now: () => Date.now() });

describe('the engine on 100,000 accounts (C102.3, C102.8)', () => {
  it('keeps to max-hops: two hops reach one email ring, four the rings the phones chain', async () => {
    const two = await search({
      config: config({ 'max-hops': 2, 'connect-kinds': ['email_address'] }),
    });
    const four = await search();

    // Account 50,000's email ring is 50,000-50,009; its phone ring 49,995-50,004.
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => syntheticAccountId(from + index)).sort();
    expect([...(two?.accountIds ?? [])].sort()).toEqual(range(50_000, 50_009));
    expect([...(four?.accountIds ?? [])].sort()).toEqual(range(49_990, 50_014));
    expect(four?.timedOut).toBe(false);
  });

  it('stops at node-limit and says so', async () => {
    const capped = await search({ config: config({ 'max-hops': 6, 'node-limit': 7 }) });

    expect(capped?.nodes.length).toBeLessThanOrEqual(7);
    expect(capped?.nodeLimitReached).toBe(true);
  });

  it('skips a hub value through the capped count, and counts it', async () => {
    const hubbed = await search({
      startAccounts: [syntheticAccountId(10)],
      config: config({ 'connect-kinds': ['phone_number_unconfirmed', 'email_address'] }),
    });

    expect(hubbed?.skippedHubValues).toBeGreaterThanOrEqual(1);
    expect(hubbed?.accountIds.length).toBeLessThan(50);
  });

  it('leaves weak kinds out without include-weak-kinds', async () => {
    const strong = await search({
      config: config({ 'connect-kinds': ['email_address', 'ip_address'] }),
    });
    const weak = await search({
      config: config({
        'connect-kinds': ['email_address', 'ip_address'],
        'include-weak-kinds': true,
      }),
    });

    expect(strong?.links.every((link) => link.kind !== 'ip_address')).toBe(true);
    expect(weak?.links.some((link) => link.kind === 'ip_address')).toBe(true);
  });

  it('starts from a value, and never puts a value or a key in a node id (P17)', async () => {
    const valueKey = syntheticValueKey(SEED, 'email', 1234);
    const found = await search({
      startAccounts: [],
      startValues: [
        {
          nodeId: newGraphNodeId(),
          kind: 'email_address',
          valueKey,
          keyId: 'synthetic-1',
          parameter: 'email',
        },
      ],
    });

    expect(found?.accountIds).toContain(syntheticAccountId(12_340));
    for (const node of found?.nodes ?? []) {
      expect(node.value).toMatch(/^(acc|gn)_[\w-]+$/);
      expect(node.value).not.toMatch(/[0-9a-f]{64}/);
    }
    expect(JSON.stringify(found?.nodes)).not.toContain(valueKey);
  });

  it('answers timed_out with what it gathered when the deadline passes', async () => {
    let calls = 0;
    const late = await searchGraph(db, plan({ deadline: 1_000 }), {
      now: () => (calls++ < 3 ? 0 : 2_000),
    });

    expect(late?.timedOut).toBe(true);
    expect(late?.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('runs at most two synchronous searches of an environment at once (P25)', async () => {
    const holders = await Promise.all([connect(), connect()]);
    try {
      for (const [slot, client] of holders.entries()) {
        await client.query('begin');
        await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `openverify/graph-query-sync/${environmentId}/${String(slot)}`,
        ]);
      }
      expect(
        await searchGraph(db, plan(), {
          now: () => Date.now(),
          claim: synchronousClaim(environmentId),
        }),
      ).toBeNull();
    } finally {
      for (const client of holders) {
        await client.query('rollback');
        client.release();
      }
    }
    expect(
      await searchGraph(db, plan(), {
        now: () => Date.now(),
        claim: synchronousClaim(environmentId),
      }),
    ).not.toBeNull();
  });

  it('says the index is incomplete while a backfill runs (H10)', async () => {
    expect(await kindsNotIndexedFor(db, environmentId, config())).toEqual([]);
    const other = (await createTestTenant(db)).environment.id;
    await markGraphKindsIncomplete(db, other, [4], new Date());

    expect(await kindsNotIndexedFor(db, other, config())).toEqual([4]);
  });
});

async function storedQuery(accountIds: string[]): Promise<string> {
  const template = await seedGraphQueryTemplate(db, environmentId, { config: config() });
  const id = newId('grphq');
  await createGraphQuery(db, environmentId, {
    id,
    graphQueryTemplateId: template.id,
    graphQueryTemplateVersionId: template.versionId,
    params: { account_id: accountIds[0] ?? '' },
    timeoutSeconds: 30,
    runSync: false,
  });
  await setGraphQueryStart(db, environmentId, id, {
    [accountIds[0] ?? '']: { start: true, account: true },
  });
  return id;
}

const deps = () => ({
  db,
  clock: fixedClock(),
  logger: createCapturingLogger(),
  events: createRecordingEventPublisher(),
});

describe('stored results (C101.4, C102.8)', () => {
  it('a redacted account leaves every stored result', async () => {
    const start = syntheticAccountId(60_000);
    const id = await storedQuery([start]);
    await processGraphQuery({ environmentId, graphQueryId: id }, deps());
    const gone = syntheticAccountId(60_001);
    expect((await getGraphQuery(db, environmentId, id))?.accountIds).toContain(gone);

    await db.transaction((tx) =>
      redactAccountGraphInTx(tx, { environmentId, accountId: gone, at: new Date() }),
    );

    const stored = await getGraphQuery(db, environmentId, id);
    expect(stored?.accountIds).not.toContain(gone);
    expect(JSON.stringify([stored?.nodes, stored?.links])).not.toContain(gone);
  });

  it('a cancel holding the row first wins over a completion waiting for it', async () => {
    const id = await storedQuery([syntheticAccountId(70_000)]);
    const client = await connect();
    try {
      await client.query('begin');
      await client.query(`select id from graph_queries where id = $1 for update`, [id]);
      const run = processGraphQuery({ environmentId, graphQueryId: id }, deps());
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      await client.query(`update graph_queries set status = 'cancelled' where id = $1`, [id]);
      await client.query('commit');
      expect(await run).toEqual({ status: 'cancelled' });
    } finally {
      client.release();
    }
    expect(await getGraphQuery(db, environmentId, id)).toMatchObject({
      status: 'cancelled',
      accountIds: [],
    });
  });

  it('a completion holding the row first wins over a cancel waiting for it', async () => {
    const id = await storedQuery([syntheticAccountId(80_000)]);
    let stored = false;
    const completion = db.transaction(async (tx) => {
      await lockGraphQuery(tx, environmentId, id);
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      stored =
        (await storeGraphQueryResult(tx, environmentId, id, {
          status: 'completed',
          nodes: [],
          links: [],
          nodeMap: {},
          accountIds: [],
          kindsNotIndexed: [],
          skippedHubValues: 0,
          nodeLimitReached: false,
          at: new Date(),
        })) !== null;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS / 5));
    const cancel = db.transaction(async (tx) => {
      const locked = await lockGraphQuery(tx, environmentId, id);
      return locked?.status;
    });
    await completion;
    expect(stored).toBe(true);
    expect(await cancel).toBe('completed');
  });
});

describe('the C102.8 budget', () => {
  it('builds the graph it searched: 100,000 accounts and their rows', async () => {
    const result: unknown = await db.execute(sql`
      select (select count(*) from accounts where environment_id = ${environmentId})::int as accounts,
        (select count(*) from graph_attributes where environment_id = ${environmentId})::int as rows`);
    const counts = result as { rows: { accounts: number; rows: number }[] };
    expect(counts.rows[0]?.accounts).toBe(ACCOUNTS);
    // Two strong rows an account, the IP rows of 40,000-59,999 and the hub's, less the two of the
    // redacted account 60,001.
    expect(counts.rows[0]?.rows).toBe(ACCOUNTS * 2 + 20_000 + 5000 - 2);
  });

  it('copies the template as buildSyntheticGraph wrote it: the seeded value keys of sampled accounts', async () => {
    const sampled = [0, 4_999, 12_345, 45_000, 99_999];
    const result: unknown = await db.execute(sql`
      select account_id, kind, value_key from graph_attributes
      where environment_id = ${environmentId}
        and account_id in (${sql.join(
          sampled.map((n) => sql`${syntheticAccountId(n)}`),
          sql`, `,
        )})
      order by account_id, kind`);
    const rows = (result as { rows: { account_id: string; kind: number; value_key: string }[] })
      .rows;

    const expected = sampled.flatMap((n) => [
      { account_id: syntheticAccountId(n), kind: 4, value_key: syntheticValueKey(SEED, 'email', Math.floor(n / 10)) },
      { account_id: syntheticAccountId(n), kind: 5, value_key: syntheticValueKey(SEED, 'phone', Math.floor((n + 5) / 10)) },
      ...(n < 5000
        ? [{ account_id: syntheticAccountId(n), kind: 7, value_key: syntheticValueKey(SEED, 'hub', 0) }]
        : []),
    ]);
    // Account 45,000 holds an IP row too (40,000-59,999): its key is a hash of the SQL's own bucket.
    expect(rows.filter((row) => row.kind !== 14)).toEqual(expected);
    expect(rows.filter((row) => row.kind === 14).map((row) => row.account_id)).toEqual([
      syntheticAccountId(45_000),
    ]);
  });
});
