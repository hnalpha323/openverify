/**
 * C102.3, C102.4 (Workflow 7B, `api-graph`): the `graph-query` job and the `graph-query-sweep` on
 * PGlite. The sweep enqueues the submitted asynchronous queries once a window, never a synchronous
 * one; the job stores the result with its event, leaves a cancelled query cancelled, answers
 * `timed_out` with what it gathered when the deadline passes, and `errored` with a code when the
 * template version is gone. The caps on a large graph are the integration suite's
 * (`graph-engine.integration.test.ts`). Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { createAccount, createGraphQuery, getGraphQuery, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedGraphAttribute,
  seedGraphQueryTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Clock } from '../../ports.js';
import {
  createRecordingEventPublisher,
  createRecordingGraphQueryQueue,
  fixedClock,
} from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { processGraphQuery } from './query.js';
import { runGraphQuerySweep } from './query-sweep.js';

let database: TestDatabase;
let db: Db;
const clock = fixedClock(new Date('2026-11-01T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const CONFIG = {
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address'],
};

/** A chain of accounts, each sharing one email key with the next. */
async function chain(environmentId: string, length: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < length; index += 1) {
    ids.push((await createAccount(db, environmentId, { id: newId('acc') })).id);
  }
  for (let index = 0; index + 1 < length; index += 1) {
    const valueKey = randomBytes(32).toString('hex');
    await seedGraphAttribute(db, environmentId, { accountId: ids[index] ?? '', kind: 4, valueKey });
    await seedGraphAttribute(db, environmentId, {
      accountId: ids[index + 1] ?? '',
      kind: 4,
      valueKey,
    });
  }
  return ids;
}

async function submitted(environmentId: string, start: string, input: { runSync?: boolean } = {}) {
  const template = await seedGraphQueryTemplate(db, environmentId, { config: CONFIG });
  const { id } = await createGraphQuery(db, environmentId, {
    id: newId('grphq'),
    graphQueryTemplateId: template.id,
    graphQueryTemplateVersionId: template.versionId,
    params: { account_id: start },
    timeoutSeconds: 30,
    runSync: input.runSync ?? false,
  });
  // The start as the API binds it (`services/graph/queries.ts`): an account by its id.
  await db.execute(sql`update graph_queries
    set node_map = ${JSON.stringify({ [start]: { start: true, account: true } })}::jsonb
    where id = ${id}`);
  return id;
}

const deps = (environmentClock: Clock = clock) => ({
  db,
  clock: environmentClock,
  logger: createCapturingLogger(),
  events: createRecordingEventPublisher(),
});

describe('the graph-query-sweep (C102.4, F40)', () => {
  it('enqueues the submitted asynchronous queries once a window, never a synchronous one', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const [start = ''] = await chain(environmentId, 1);
    const queued = await submitted(environmentId, start);
    await submitted(environmentId, start, { runSync: true });
    const queries = createRecordingGraphQueryQueue();
    const sweep = () => runGraphQuerySweep({ db, clock, logger: createCapturingLogger(), queries });

    await sweep();
    await sweep();

    expect(queries.jobs.filter((job) => job.environmentId === environmentId)).toEqual([
      { environmentId, graphQueryId: queued },
    ]);
  });
});

describe('the graph-query job (C102.3, C102.4)', () => {
  it('stores the result with its event', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const ids = await chain(environmentId, 3);
    const id = await submitted(environmentId, ids[0] ?? '');
    const run = deps();

    expect(await processGraphQuery({ environmentId, graphQueryId: id }, run)).toEqual({
      status: 'completed',
    });

    const stored = await getGraphQuery(db, environmentId, id);
    expect([...(stored?.accountIds ?? [])].sort()).toEqual([...ids].sort());
    expect(run.events.named('graph-query.completed')).toHaveLength(1);
  });

  it('audits an asynchronous run’s terminal status with its counts, as a system entry (C102.7)', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const ids = await chain(environmentId, 2);
    const id = await submitted(environmentId, ids[0] ?? '');

    await processGraphQuery({ environmentId, graphQueryId: id }, deps());

    const result = await db.execute(sql`select actor_type, action, resource_type, metadata
      from audit_logs where environment_id = ${environmentId} and resource_id = ${id}`);
    const rows = (result as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toEqual([
      expect.objectContaining({
        actor_type: 'system',
        action: 'graph-query.completed',
        resource_type: 'graph-query',
        metadata: expect.objectContaining({ 'account-count': 2 }) as unknown,
      }),
    ]);
  });

  it('answers timed_out with what it gathered once the deadline passed', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const ids = await chain(environmentId, 3);
    const id = await submitted(environmentId, ids[0] ?? '');
    let reading = clock.now().getTime();
    const late: Clock = { now: () => new Date((reading += 31_000)) };
    const run = deps(late);

    expect(await processGraphQuery({ environmentId, graphQueryId: id }, run)).toEqual({
      status: 'timed_out',
    });

    expect((await getGraphQuery(db, environmentId, id))?.status).toBe('timed_out');
    expect(run.events.named('graph-query.timed-out')).toHaveLength(1);
  });

  it('leaves a cancelled query cancelled, and errors a query whose template version is unreadable', async () => {
    const environmentId = (await createTestTenant(db)).environment.id;
    const [start = ''] = await chain(environmentId, 1);
    const cancelled = await submitted(environmentId, start);
    await db.execute(sql`update graph_queries set status = 'cancelled' where id = ${cancelled}`);
    expect(await processGraphQuery({ environmentId, graphQueryId: cancelled }, deps())).toEqual({
      status: 'cancelled',
    });

    const broken = await submitted(environmentId, start);
    await db.execute(sql`update graph_query_template_versions set config = '{}'::jsonb
      where id = (select graph_query_template_version_id from graph_queries where id = ${broken})`);
    const run = deps();
    expect(await processGraphQuery({ environmentId, graphQueryId: broken }, run)).toEqual({
      status: 'errored',
    });
    expect(await getGraphQuery(db, environmentId, broken)).toMatchObject({
      status: 'errored',
      lastErrorCode: 'graph_query_failed',
    });
    expect(run.events.named('graph-query.errored')).toHaveLength(1);
  });
});
