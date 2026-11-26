/**
 * Workflow 7B Stage 1b, checkpoint (G): what `foundation-7b` builds in the graph repositories (the
 * index outbox write of C101.3, the per-kind state read of C101.5, the query redaction of C102.7
 * with `stubEventPayloads` and `forgetStoredResponses`, the C16 read with its default of 30 days),
 * and the subject prefix; `graph-repositories.test.ts` covers what `api-graph` built. Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  openGraphQueryParams,
  seedGraphQuery,
  seedGraphQueryTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createApiLog } from './api-logs.js';
import { createEvent } from './events.js';
import {
  createGraphIndexJob,
  getGraphIndexJob,
  listGraphIndexStates,
  listGraphQueriesDueForRetention,
  redactExpiredGraphQueries,
  redactGraphQueryRecords,
} from './index.js';
import { updateEnvironmentSettings } from './organizations.js';
import { subjectIdsIn } from './subject-ids.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

async function rows<Row>(statement: ReturnType<typeof sql>): Promise<Row[]> {
  return ((await database.db.execute(statement)) as unknown as { rows: Row[] }).rows;
}

async function seedQuery(input: { createdAt?: Date } = {}) {
  const { environment } = await createTestTenant(database.db);
  const environmentId = environment.id;
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const template = await seedGraphQueryTemplate(database.db, environmentId);
  const query = await seedGraphQuery(database.db, environmentId, {
    graphQueryTemplateId: template.id,
    graphQueryTemplateVersionId: template.versionId,
    params: { email: 'synthetic@example.com' },
    accountIds: [inquiry.accountId],
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
  return { environmentId, queryId: query.id, accountId: inquiry.accountId, template };
}

describe('the graph index outbox (C101.3, H23)', () => {
  it('writes one pending row per inquiry; a later call keeps the first', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);

    expect(
      await createGraphIndexJob(database.db, environment.id, {
        inquiryId: inquiry.id,
        triggerStatus: 'completed',
      }),
    ).toBe(true);
    expect(
      await createGraphIndexJob(database.db, environment.id, {
        inquiryId: inquiry.id,
        triggerStatus: 'expired',
      }),
    ).toBe(false);

    expect(await getGraphIndexJob(database.db, environment.id, inquiry.id)).toMatchObject({
      environmentId: environment.id,
      inquiryId: inquiry.id,
      triggerStatus: 'completed',
      status: 'pending',
      attempts: 0,
      lastErrorCode: null,
      enqueuedAt: null,
      indexedAt: null,
    });
  });

  it('reads nothing of another environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    await createGraphIndexJob(database.db, environment.id, {
      inquiryId: inquiry.id,
      triggerStatus: 'failed',
    });

    expect(await getGraphIndexJob(database.db, other.environment.id, inquiry.id)).toBeNull();
  });
});

describe('the per-kind index state (C101.5, H10)', () => {
  it('reads no row for a new environment, and the environment’s rows in kind order', async () => {
    const { environment } = await createTestTenant(database.db);
    expect(await listGraphIndexStates(database.db, environment.id)).toEqual([]);

    await database.db.execute(sql`
      insert into graph_index_state (environment_id, kind, complete, completed_at)
      values (${environment.id}, 13, false, null), (${environment.id}, 4, true, now())`);

    const states = await listGraphIndexStates(database.db, environment.id);
    expect(states.map(({ kind, complete }) => ({ kind, complete }))).toEqual([
      { kind: 4, complete: true },
      { kind: 13, complete: false },
    ]);
  });
});

describe('the redaction of a stored graph query (C102.7, P04)', () => {
  it('empties the params, nodes, links, node map and accounts, and sets redacted-at', async () => {
    const { environmentId, queryId } = await seedQuery();
    await database.db.execute(sql`
      update graph_queries set links = '[{"from":"acc_x","to":"gn_x","kind":"email_address"}]',
        node_map = '{"gn_x":{"kind":4}}' where id = ${queryId}`);
    const at = new Date('2026-11-01T00:00:00.000Z');

    const redacted = await redactGraphQueryRecords(database.db, environmentId, queryId, { at });

    expect(redacted).toMatchObject({ alreadyRedacted: false, stubbedEvents: 0 });
    expect(redacted?.query.redactedAt).toEqual(at);
    expect(
      await rows(sql`select params, nodes, links, node_map, account_ids, status
        from graph_queries where id = ${queryId}`),
    ).toEqual([
      {
        params: null,
        nodes: [],
        links: [],
        node_map: {},
        account_ids: [],
        status: 'completed',
      },
    ]);
    expect(await openGraphQueryParams(database.db, environmentId, queryId)).toBeNull();
  });

  it('keeps the first time on a second run, and answers null for another environment', async () => {
    const { environmentId, queryId } = await seedQuery();
    const first = new Date('2026-11-01T00:00:00.000Z');
    await redactGraphQueryRecords(database.db, environmentId, queryId, { at: first });

    const again = await redactGraphQueryRecords(database.db, environmentId, queryId, {
      at: new Date('2026-11-02T00:00:00.000Z'),
    });

    expect(again?.alreadyRedacted).toBe(true);
    expect(again?.query.redactedAt).toEqual(first);
    const { environment } = await createTestTenant(database.db);
    expect(await redactGraphQueryRecords(database.db, environment.id, queryId)).toBeNull();
  });

  it('stubs the query’s events and reports how many', async () => {
    const { environmentId, queryId } = await seedQuery();
    const event = await createEvent(database.db, environmentId, {
      id: `evt_${queryId.slice(6)}`,
      name: 'graph-query.completed',
      objectType: 'graph-query',
      objectId: queryId,
      payload: { data: { type: 'graph-query', id: queryId, attributes: { status: 'completed' } } },
    });

    const redacted = await redactGraphQueryRecords(database.db, environmentId, queryId);

    expect(redacted?.stubbedEvents).toBe(1);
    const [stored] = await rows<{ redacted_at: unknown }>(
      sql`select redacted_at from events where id = ${event.id}`,
    );
    expect(stored?.redacted_at).not.toBeNull();
  });

  it('forgets the stored copies that are about it or mention it', async () => {
    const { environmentId, queryId } = await seedQuery();
    const logged = (resourceId: string | null) =>
      createApiLog(database.db, environmentId, {
        id: testId('alog'),
        method: 'GET',
        path: '/api/v1/graph-queries',
        route: '/api/v1/graph-queries',
        status: 200,
        durationMs: 1,
        requestId: 'req_synthetic',
        resourceId,
        ip: '192.0.2.1',
        userAgent: null,
        query: null,
        requestBody: { data: { attributes: { 'parameter-map': { email: 'x@example.com' } } } },
        responseBody: { data: [{ id: queryId }] },
      });
    const about = await logged(queryId);
    const mention = await logged(null);

    await redactGraphQueryRecords(database.db, environmentId, queryId);

    for (const log of [about, mention]) {
      expect(
        await rows(sql`select request_body, response_body from api_logs where id = ${log.id}`),
      ).toEqual([{ request_body: null, response_body: null }]);
    }
  });
});

describe('the C16 read of graph queries (C102.7; decision 19)', () => {
  it('finds the unredacted queries past 30 days by default, or the environment’s window, oldest first', async () => {
    const now = new Date('2026-11-01T00:00:00.000Z');
    const oldest = await seedQuery({ createdAt: new Date('2026-09-01T00:00:00.000Z') });
    const older = await seedQuery({ createdAt: new Date('2026-09-15T00:00:00.000Z') });
    const recent = await seedQuery({ createdAt: new Date('2026-10-20T00:00:00.000Z') });
    const redacted = await seedQuery({ createdAt: new Date('2026-08-01T00:00:00.000Z') });
    await redactGraphQueryRecords(database.db, redacted.environmentId, redacted.queryId);
    const short = await seedQuery({ createdAt: new Date('2026-10-28T00:00:00.000Z') });
    await updateEnvironmentSettings(database.db, short.environmentId, {
      'graph-query-retention-days': 1,
    });
    const long = await seedQuery({ createdAt: new Date('2026-09-01T00:00:00.000Z') });
    await updateEnvironmentSettings(database.db, long.environmentId, {
      'graph-query-retention-days': 365,
    });

    const due = await listGraphQueriesDueForRetention(database.db, { now, limit: 1000 });

    const ours = new Set(
      [oldest, older, recent, redacted, short, long].map((seeded) => seeded.queryId),
    );
    expect(due.filter((row) => ours.has(row.id))).toEqual([
      { id: oldest.queryId, environmentId: oldest.environmentId },
      { id: older.queryId, environmentId: older.environmentId },
      { id: short.queryId, environmentId: short.environmentId },
    ]);
  });
});

describe('the C16 step over graph queries (C102.7)', () => {
  it('redacts one batch of what is due, oldest first, and answers how many', async () => {
    const now = new Date('2026-11-01T00:00:00.000Z');
    const due = await seedQuery({ createdAt: new Date('2026-08-15T00:00:00.000Z') });
    const kept = await seedQuery({ createdAt: new Date('2026-10-30T00:00:00.000Z') });

    let redacted = 0;
    for (let batch = 1; batch > 0;) {
      batch = await redactExpiredGraphQueries(database.db, { now, limit: 1000 });
      redacted += batch;
    }

    expect(redacted).toBeGreaterThanOrEqual(1);
    expect(await openGraphQueryParams(database.db, due.environmentId, due.queryId)).toBeNull();
    expect(await openGraphQueryParams(database.db, kept.environmentId, kept.queryId)).toEqual({
      email: 'synthetic@example.com',
    });
    expect(await redactExpiredGraphQueries(database.db, { now, limit: 1000 })).toBe(0);
  });
});

describe('the graph-query subject prefix (C107.5)', () => {
  it('finds grphq ids, and not the template ids', () => {
    const query = testId('grphq');
    const template = testId('grqt');
    const version = testId('grqtv');

    expect(subjectIdsIn({ data: { id: query }, included: [template, version] })).toEqual([query]);
  });
});
